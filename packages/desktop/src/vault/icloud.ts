import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Files iCloud has offloaded (Sync and Collaboration, "Cloud folders"). On
 * current macOS an offloaded file keeps its name and size but carries the
 * "dataless" flag, and its bytes stay in iCloud until something asks. Anur
 * fetches such a file before reading it and never takes it for an empty one.
 */
const run = promisify(execFile);
const SF_DATALESS = 0x40000000;
const isMac = process.platform === "darwin";

/** The folder's offloaded Markdown files, relative paths; empty off macOS or on any error. */
export async function listOffloaded(root: string): Promise<string[]> {
  if (!isMac) return [];
  try {
    const { stdout } = await run(
      "find",
      [root, "-flags", "+dataless", "-name", "*.md", "-not", "-path", "*/.*"],
      {
        maxBuffer: 1 << 24,
      },
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((p) => path.relative(root, p).split(path.sep).join("/").normalize("NFC"))
      .sort();
  } catch {
    return [];
  }
}

export async function isDataless(file: string): Promise<boolean> {
  if (!isMac) return false;
  try {
    const { stdout } = await run("stat", ["-f", "%Xf", file]);
    return (Number.parseInt(stdout.trim(), 16) & SF_DATALESS) !== 0;
  } catch {
    return false;
  }
}

/** Ask iCloud for the file's bytes, then wait until they are here. */
export async function downloadFromICloud(file: string, timeoutMs = 60_000): Promise<void> {
  await run("brctl", ["download", file]);
  const until = Date.now() + timeoutMs;
  while (await isDataless(file)) {
    if (Date.now() > until)
      throw new Error("iCloud didn't send it in time; check the connection and try again");
    await new Promise((r) => setTimeout(r, 250));
  }
}

export class NotDownloaded extends Error {}

export type ReadDeps = {
  isDataless: (file: string) => Promise<boolean>;
  download: (file: string) => Promise<void>;
  read: (file: string) => Promise<Uint8Array>;
  size: (file: string) => Promise<number>;
};

const realDeps: ReadDeps = {
  isDataless,
  download: (file) => downloadFromICloud(file),
  read: (file) => readFile(file),
  size: async (file) => (await stat(file)).size,
};

/**
 * A doc's bytes, fetching it from iCloud first if it is offloaded. A read that
 * comes back empty while the file says it has bytes counts as not downloaded,
 * never as an empty doc. `readDoc` in doc-file.ts decodes them.
 */
export async function readDocBytes(file: string, deps: ReadDeps = realDeps): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await deps.isDataless(file)) {
      try {
        await deps.download(file);
      } catch (e) {
        throw new NotDownloaded(
          `${path.basename(file)} is in iCloud and couldn't be downloaded: ${(e as Error).message}`,
          {
            cause: e,
          },
        );
      }
    }
    const [bytes, size] = await Promise.all([deps.read(file), deps.size(file)]);
    if (bytes.length > 0 || size === 0) return bytes;
  }
  throw new NotDownloaded(
    `${path.basename(file)} read as empty though it has content; it may still be in iCloud`,
  );
}
