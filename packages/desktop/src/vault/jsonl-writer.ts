import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, stat, truncate, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { LineEnvelope, encodeLine, nextStamp, parseJsonl, type ParsedJsonl } from "@anur/core";
import type { z } from "zod";

/** A random line ID: 16 URL-safe characters, 96 bits. */
export function newLineId(): string {
  return randomBytes(12).toString("base64url");
}

/** Files this process is writing. Each file has one writer, so a second one is a bug. */
const openFiles = new Set<string>();

type Payload = Record<string, unknown> & { id?: never; at?: never; dev?: never; seq?: never };

/**
 * Appends lines to one device's JSONL file in `.anur/`.
 *
 * - Each line is written whole and flushed to disk before `append` resolves.
 * - On open, a torn last line from a crash is cut off; a complete last line
 *   that only lost its newline gets the newline back.
 * - Times never step back within the file, and the counter carries on from
 *   the file's last line.
 */
export class JsonlWriter {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(
    readonly file: string,
    private readonly handle: FileHandle,
    private readonly device: string,
    private last: { at: string; seq: number } | null,
    private readonly now: () => number,
    private readonly newId: () => string,
  ) {}

  static async open(
    file: string,
    device: string,
    opts: { now?: () => number; newId?: () => string } = {},
  ): Promise<JsonlWriter> {
    const key = path.resolve(file);
    if (openFiles.has(key)) throw new Error(`${file} already has a writer in this process`);
    openFiles.add(key);
    try {
      await mkdir(path.dirname(key), { recursive: true });
      const last = await repairTail(key);
      const handle = await open(key, "a");
      return new JsonlWriter(
        key,
        handle,
        device,
        last,
        opts.now ?? Date.now,
        opts.newId ?? newLineId,
      );
    } catch (e) {
      openFiles.delete(key);
      throw e;
    }
  }

  /** Append one line; resolves with the line as written, once it is on disk. */
  append<P extends Payload>(payload: P): Promise<LineEnvelope & P> {
    const run = async () => {
      if (this.closed) throw new Error(`${this.file} is closed`);
      const stamp = nextStamp(this.last, this.now());
      const line = { id: this.newId(), at: stamp.at, dev: this.device, seq: stamp.seq, ...payload };
      await this.handle.appendFile(encodeLine(line), "utf8");
      await this.handle.datasync();
      this.last = stamp;
      return line;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async close(): Promise<void> {
    await this.queue;
    if (this.closed) return;
    this.closed = true;
    openFiles.delete(this.file);
    await this.handle.close();
  }
}

/** Cut a torn tail, restore a lost newline, and return the last complete line's stamp. */
async function repairTail(file: string): Promise<{ at: string; seq: number } | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return null;
  }
  if (text !== "" && !text.endsWith("\n")) {
    const cut = text.lastIndexOf("\n") + 1;
    const tail = text.slice(cut);
    const tailOk = parseJsonl(`${tail}\n`, LineEnvelope.loose()).lines.length === 1;
    if (tailOk) {
      const handle = await open(file, "a");
      await handle.appendFile("\n");
      await handle.datasync();
      await handle.close();
      text = `${text}\n`;
    } else {
      await truncate(file, Buffer.byteLength(text.slice(0, cut), "utf8"));
      text = text.slice(0, cut);
    }
  }
  const lines = parseJsonl(text, LineEnvelope.loose()).lines;
  const last = lines.at(-1);
  return last ? { at: last.at, seq: last.seq } : null;
}

/** Read one JSONL file; a missing file is an empty one. */
export async function readJsonlFile<T extends LineEnvelope>(
  file: string,
  schema: z.ZodType<T>,
): Promise<ParsedJsonl<T>> {
  try {
    await stat(file);
  } catch {
    return { lines: [], tornTail: false, badLines: 0 };
  }
  return parseJsonl(await readFile(file, "utf8"), schema);
}
