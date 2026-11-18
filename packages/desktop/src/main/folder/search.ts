import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { normalizeDocPath } from "@anur/core";
import type { FolderState } from "../../shared/ipc-contract.ts";

/**
 * Search and new docs (task 2.26). Search reads the folder's Markdown files
 * from disk, case ignored, and returns each matching line; files still in
 * iCloud are left out rather than downloaded, and files over 5 MB are
 * skipped. A file's text is kept while it is unchanged, so searching as
 * you type stays quick.
 */

export type SearchMatch = { path: string; line: number; column: number; text: string };

const MAX_BYTES = 5 * 1024 * 1024;
const cache = new Map<string, { mtime: number; text: string }>();

export async function textOf(file: string): Promise<string | null> {
  try {
    const s = await stat(file);
    if (s.size > MAX_BYTES) return null;
    const hit = cache.get(file);
    if (hit?.mtime === s.mtimeMs) return hit.text;
    const text = await readFile(file, "utf8");
    cache.set(file, { mtime: s.mtimeMs, text });
    return text;
  } catch {
    return null;
  }
}

/** A line cut down around its match, so long lines read well in a list. */
function snippet(line: string, at: number, length: number): { text: string; column: number } {
  const start = Math.max(0, at - 40);
  const end = Math.min(line.length, at + length + 80);
  const lead = start > 0 ? "…" : "";
  return {
    text: lead + line.slice(start, end).trim() + (end < line.length ? "…" : ""),
    column: at,
  };
}

export async function searchFolder(
  folder: FolderState,
  query: string,
  limit = 200,
): Promise<{ matches: SearchMatch[]; truncated: boolean; skipped: number }> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { matches: [], truncated: false, skipped: 0 };
  const offloaded = new Set(folder.offloaded);
  const matches: SearchMatch[] = [];
  for (const doc of folder.docs) {
    if (offloaded.has(doc)) continue;
    const text = await textOf(path.join(folder.path, doc));
    if (text === null || !text.toLowerCase().includes(needle)) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const at = line.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const { text: shown, column } = snippet(line, at, needle.length);
      matches.push({ path: doc, line: i + 1, column, text: shown });
      if (matches.length >= limit) return { matches, truncated: true, skipped: offloaded.size };
    }
  }
  return { matches, truncated: false, skipped: offloaded.size };
}

/**
 * A new doc at `requested`, a Markdown path in the folder: its parent
 * folders made, its title as its first line. Never over an existing file.
 */
export async function createDoc(
  folder: FolderState,
  requested: string,
): Promise<{ kind: "created"; path: string } | { kind: "failed"; reason: string }> {
  if (folder.mode !== "writable") return { kind: "failed", reason: "This folder is read-only." };
  let rel: string;
  try {
    rel = normalizeDocPath(requested);
  } catch (e) {
    return { kind: "failed", reason: (e as Error).message };
  }
  if (!rel.toLowerCase().endsWith(".md"))
    return { kind: "failed", reason: "A doc's name ends in .md." };
  if (rel.split("/").some((part) => part.startsWith("."))) {
    return { kind: "failed", reason: "A doc can't go in a hidden folder." };
  }
  const full = path.resolve(folder.path, rel);
  if (!full.startsWith(path.resolve(folder.path) + path.sep)) {
    return { kind: "failed", reason: "That's outside this folder." };
  }
  const title = path.basename(rel).replace(/\.md$/i, "");
  try {
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, `# ${title}\n\n`, { flag: "wx" });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return {
      kind: "failed",
      reason: code === "EEXIST" ? `${rel} already exists.` : (e as Error).message,
    };
  }
  return { kind: "created", path: rel };
}
