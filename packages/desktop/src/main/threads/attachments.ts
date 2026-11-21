/**
 * Files and folders a person attaches to a thread: what's read inline, what's listed, and how big is too big.
 */
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { type KnownThreadLine, type SectionId, type SnapshotHash } from "@anur/core";

export type Carried = {
  id: string;
  /** The thread that picked it up, or "" for one a person added to the section. */
  thread: string;
  source: "file" | "doc" | "command" | "fetch" | "search" | "mcp" | "attachment" | "link";
  label: string;
  ref: string;
  hash: SnapshotHash | null;
  trust: "trusted" | "untrusted";
  /** Kept on the device that read it: see InputLine.local. */
  local: boolean;
  at: string;
};

/** Every file under `dir`, relative to it, with forward slashes. */
export async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(dir, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(dir, rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** A line for an input a person added (10.1). */
export function addedLine(
  section: SectionId,
  thread: string | null,
  source: "attachment" | "file" | "link",
  ref: string,
): Record<string, unknown> {
  return {
    kind: "added-input",
    section,
    thread,
    source,
    label: source === "link" ? ref.replace(/^https?:\/\//, "") : ref,
    ref,
    hash: null,
    // A link is text from the web; what the person attached is theirs.
    trust: source === "link" ? "untrusted" : "trusted",
  };
}

/** An added input as it is carried to a thread. */
export function addedCarried(l: Extract<KnownThreadLine, { kind: "added-input" }>): Carried {
  return {
    id: l.id,
    thread: l.thread ?? "",
    source: l.source,
    label: l.label,
    ref: l.ref,
    hash: l.hash,
    trust: l.trust,
    local: false,
    at: l.at,
  };
}

/** A text file attached to a message goes into the prompt whole up to this size. */
export const ATTACH_INLINE = 200 * 1024;

export const TEXT_EXT =
  /^\.(md|markdown|txt|text|html?|csv|tsv|json|ya?ml|xml|toml|ini|log|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|php|sh|sql|css|scss)$/;

/** A folder copied in from outside stays under this; a bigger one isn't copied. */
export const FOLDER_LIMIT = 50 * 1024 * 1024;

/** A folder's size on disk, its hidden files left out. */
export async function sizeOf(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += await sizeOf(full);
    else if (e.isFile()) total += (await lstat(full)).size;
    if (total > FOLDER_LIMIT) return total;
  }
  return total;
}

/** A folder's files, relative to it, up to 200; null when it isn't a folder. */
export async function listFolder(dir: string): Promise<string[] | null> {
  const kind = await lstat(dir).catch(() => null);
  if (!kind?.isDirectory()) return null;
  const out: string[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || out.length >= 200) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(`- ${path.relative(dir, full)}`);
    }
  };
  await walk(dir);
  return out;
}
