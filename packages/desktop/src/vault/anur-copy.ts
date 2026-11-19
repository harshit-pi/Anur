import { copyFile, mkdir, readFile as fsReadFile, stat, utimes } from "node:fs/promises";
import path from "node:path";

/**
 * This Mac's own copies of `.anur` files in iCloud folders, as Obsidian keeps
 * its index outside the vault: when macOS offloads a file to free space, a
 * read uses the copy instead of waiting on a download. A copy is used only
 * while it matches the file's size and modified time, so another device's
 * write is always read from the file itself.
 */
let root: string | null = null;

/** Where the copies live; until set (as in tests), reads go to the files. */
export function keepAnurCopiesIn(dir: string | null): void {
  root = dir;
}

const ANUR = `${path.sep}.anur${path.sep}`;

/** The copy's path for a file under an iCloud folder's `.anur`, else null. */
export function copyOf(file: string): string | null {
  if (!root) return null;
  const abs = path.resolve(file);
  if (
    !abs.includes(ANUR) ||
    !abs.includes(`${path.sep}Library${path.sep}Mobile Documents${path.sep}`)
  )
    return null;
  return path.join(root, abs);
}

/** An offloaded file keeps its size but holds no blocks on disk. */
const offloaded = (s: { size: number; blocks: number }) => s.size > 0 && s.blocks === 0;
/** Modified times to the millisecond: a copy's is set from the file's. */
const sameTime = (a: number, b: number) => Math.floor(a) === Math.floor(b);

export function readFile(file: string): Promise<Buffer>;
export function readFile(file: string, encoding: "utf8"): Promise<string>;
export async function readFile(file: string, encoding?: "utf8"): Promise<string | Buffer> {
  const copy = copyOf(file);
  if (!copy) return encoding ? fsReadFile(file, encoding) : fsReadFile(file);
  const s = await stat(file);
  if (offloaded(s)) {
    const c = await stat(copy).catch(() => null);
    if (c && c.size === s.size && sameTime(c.mtimeMs, s.mtimeMs))
      return encoding ? fsReadFile(copy, encoding) : fsReadFile(copy);
  }
  const data = encoding ? await fsReadFile(file, encoding) : await fsReadFile(file);
  void keep(file, copy).catch(() => undefined);
  return data;
}

/** A `.anur` file was just written here: its copy follows, while the file is surely on disk. */
export function anurWritten(file: string): void {
  const copy = copyOf(file);
  if (copy) void keep(file, copy).catch(() => undefined);
}

/** Copy the file, with its modified time, unless the copy already matches. */
async function keep(file: string, copy: string): Promise<void> {
  const s = await stat(file);
  if (offloaded(s)) return;
  const c = await stat(copy).catch(() => null);
  if (c && c.size === s.size && sameTime(c.mtimeMs, s.mtimeMs)) return;
  await mkdir(path.dirname(copy), { recursive: true });
  await copyFile(file, copy);
  // The file may have changed while it was copied: then the times differ and the copy isn't used.
  await utimes(copy, s.atime, s.mtime);
}
