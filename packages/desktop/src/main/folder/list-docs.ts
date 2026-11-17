import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * The folder's Markdown files, for the left sidebar: every `.md` file
 * outside dot-folders such as `.git`, `.anur` and `.obsidian`, and outside
 * `node_modules`. Paths are relative, with forward slashes, sorted the way a
 * person reads a tree: folders' files together, case ignored.
 */
export const MAX_DOCS = 20_000;

const SKIP_DIRS = new Set(["node_modules"]);

export async function listDocs(
  root: string,
  max = MAX_DOCS,
  ext = ".md",
): Promise<{ docs: string[]; truncated: boolean }> {
  const docs: string[] = [];
  let truncated = false;

  async function walk(rel: string): Promise<void> {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return; // unreadable folder: skip it, as Obsidian does
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(childRel);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(ext)) {
        if (docs.length >= max) {
          truncated = true;
          return;
        }
        docs.push(childRel.normalize("NFC"));
      }
    }
  }

  await walk("");
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  docs.sort((a, b) => collator.compare(a, b));
  return { docs, truncated };
}
