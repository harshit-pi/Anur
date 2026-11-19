import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A doc's title follows its file name: renaming "Untitled.md" to "GTM.md"
 * turns its "# Untitled" into "# GTM". Only a title that matched the old
 * name changes; one written apart from the file name stays as it is.
 */
export function retitled(text: string, from: string, to: string): string | null {
  const oldName = nameOf(from);
  const newName = nameOf(to);
  if (oldName === newName) return null;
  // Past a front matter block and blank lines, the first line is the title.
  const front = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  let at = front ? front[0].length : 0;
  while (text.startsWith("\n", at) || text.startsWith("\r\n", at))
    at += text.startsWith("\r\n", at) ? 2 : 1;
  const end = text.indexOf("\n", at);
  const line = text.slice(at, end < 0 ? text.length : end).replace(/\r$/, "");
  const m = /^(#[ \t]+)(.*?)[ \t]*$/.exec(line);
  if (!m || m[2] !== oldName) return null;
  return `${text.slice(0, at)}${m[1] ?? "# "}${newName}${text.slice(at + line.length)}`;
}

function nameOf(rel: string): string {
  return path.posix.basename(rel).replace(/\.md$/i, "");
}

/** Renames each moved doc's title where it matched the old name. */
export async function retitleMoved(
  folder: string,
  docs: readonly { from: string; to: string }[],
): Promise<void> {
  for (const d of docs) {
    if (!/\.md$/i.test(d.to)) continue;
    const full = path.join(folder, d.to);
    try {
      const text = await readFile(full, "utf8");
      const next = retitled(text, d.from, d.to);
      if (next !== null) await writeFile(full, next);
    } catch {
      // An unreadable doc keeps its title; the move itself is done.
    }
  }
}
