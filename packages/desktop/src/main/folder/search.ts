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

export type SearchMatch = {
  path: string;
  line: number;
  column: number;
  text: string;
  length?: number;
};

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

/**
 * Docs that hold every word, in any order (2.26), each with its best lines:
 * the lines with the most of the words first, up to PER_DOC. The docs with
 * the most matching lines come first. Docs still in iCloud are counted, not read.
 */
const PER_DOC = 3;

export async function searchFolder(
  folder: FolderState,
  query: string,
  limit = 600,
): Promise<{ matches: SearchMatch[]; truncated: boolean; skipped: number }> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { matches: [], truncated: false, skipped: 0 };
  const offloaded = new Set(folder.offloaded);
  const found: { doc: string; hits: number; lines: SearchMatch[] }[] = [];
  for (const doc of folder.docs) {
    if (offloaded.has(doc)) continue;
    const text = await textOf(path.join(folder.path, doc));
    if (text === null) continue;
    const lower = text.toLowerCase();
    if (!words.every((w) => lower.includes(w))) continue;
    const lines = text.split("\n");
    const hits: { i: number; count: number; at: number; len: number }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] ?? "").toLowerCase();
      const at = words.map((w) => ({ w, at: line.indexOf(w) })).filter((x) => x.at >= 0);
      const first = at.sort((a, b) => a.at - b.at)[0];
      if (first) hits.push({ i, count: at.length, at: first.at, len: first.w.length });
    }
    const best = [...hits].sort((a, b) => b.count - a.count || a.i - b.i).slice(0, PER_DOC);
    found.push({
      doc,
      hits: hits.length,
      lines: best
        .sort((a, b) => a.i - b.i)
        .map((h) => {
          const { text: shown, column } = snippet(lines[h.i] ?? "", h.at, h.len);
          return { path: doc, line: h.i + 1, column, text: shown, length: h.len };
        }),
    });
  }
  found.sort((a, b) => b.hits - a.hits || a.doc.localeCompare(b.doc));
  const matches = found.flatMap((f) => f.lines);
  return {
    matches: matches.slice(0, limit),
    truncated: matches.length > limit,
    skipped: offloaded.size,
  };
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
  // As folders: no \ or : in a name, so a tab that is no file, as a task
  // report ("anur:task/…"), is never a folder to make.
  if (rel.split("/").some((part) => /[\\:]/.test(part)))
    return { kind: "failed", reason: "Names can't hold \\ or :." };
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
