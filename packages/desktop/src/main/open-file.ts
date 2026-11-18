import { stat } from "node:fs/promises";
import path from "node:path";

/**
 * The folder to open for a Markdown file opened from Finder: one already
 * open that holds it, else the nearest folder above it that Anur has used
 * (it has `.anur`), else a recent folder that holds it, else its own folder.
 */
export async function folderFor(
  file: string,
  open: readonly string[],
  recent: readonly string[],
  home: string,
): Promise<string> {
  const inside = (dir: string) => file.startsWith(dir + path.sep);
  const deepest = (dirs: readonly string[]) =>
    dirs.filter(inside).sort((a, b) => b.length - a.length)[0];
  const already = deepest(open);
  if (already) return already;
  // Up from the file, stopping at the home folder or the top of the disk.
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const used = await stat(path.join(dir, ".anur")).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (used) return dir;
    if (dir === home || path.dirname(dir) === dir) break;
  }
  return deepest(recent) ?? path.dirname(file);
}
