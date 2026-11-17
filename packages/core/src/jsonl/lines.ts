import { z } from "zod";

/**
 * Every line Anur writes in `.anur/` (Data Model, "`.anur/` on disk"):
 *
 * - `id`: unique, so a line copied by sync or git is counted once;
 * - `at`: wall-clock time, ISO 8601 in UTC with milliseconds;
 * - `dev`: the device that wrote it;
 * - `seq`: that device's counter for the file, so its lines keep their order.
 *
 * Readers deduplicate by `id` and sort by `at`, then `dev`, then `seq`, so
 * lines from two machines combine cleanly. A file's own fields sit beside
 * these four, so a line stays readable in any text editor.
 */
export const LineEnvelope = z.object({
  id: z.string().min(8).max(64),
  at: z.iso.datetime({ precision: 3 }),
  dev: z.string().min(1).max(128),
  seq: z.int().nonnegative(),
});
export type LineEnvelope = z.infer<typeof LineEnvelope>;

/** One line of a JSONL file, ending in a newline. */
export function encodeLine(line: LineEnvelope & Record<string, unknown>): string {
  return `${JSON.stringify(line)}\n`;
}

export type ParsedJsonl<T> = {
  lines: T[];
  /** The last line was cut off mid-write, as after a crash; it is skipped, never an error. */
  tornTail: boolean;
  /** Lines before the last that could not be read; skipped and counted, so they can be reported. */
  badLines: number;
};

/**
 * Read a JSONL file's text. A last line that doesn't parse is a torn write and
 * is skipped quietly; any other unreadable line is skipped and counted.
 */
export function parseJsonl<T extends LineEnvelope>(
  text: string,
  schema: z.ZodType<T>,
): ParsedJsonl<T> {
  const raw = text.split("\n");
  const endsClean = text.endsWith("\n") || text === "";
  if (endsClean) raw.pop();
  const lines: T[] = [];
  let tornTail = false;
  let badLines = 0;
  raw.forEach((row, i) => {
    const isLast = i === raw.length - 1;
    const line = row.replace(/\r$/, "");
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      value = undefined;
    }
    const result = value === undefined ? null : schema.safeParse(value);
    if (result?.success) lines.push(result.data);
    else if (isLast && !endsClean) tornTail = true;
    else badLines++;
  });
  return { lines, tornTail, badLines };
}

/** The order every reader uses: time, then device, then the device's counter. */
export function compareLines(a: LineEnvelope, b: LineEnvelope): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.dev !== b.dev) return a.dev < b.dev ? -1 : 1;
  return a.seq - b.seq;
}

/** Combine the files every device wrote for one record, counting each line once. */
export function mergeLines<T extends LineEnvelope>(...files: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const file of files) {
    for (const line of file) {
      if (seen.has(line.id)) continue;
      seen.add(line.id);
      out.push(line);
    }
  }
  return out.sort(compareLines);
}

/**
 * The next line's time and counter for a writer: never earlier than its last
 * line, so a clock that steps back can't reorder one device's own lines.
 */
export function nextStamp(
  last: Pick<LineEnvelope, "at" | "seq"> | null,
  nowMs: number,
): { at: string; seq: number } {
  const now = new Date(nowMs).toISOString();
  if (!last) return { at: now, seq: 0 };
  return { at: now > last.at ? now : last.at, seq: last.seq + 1 };
}
