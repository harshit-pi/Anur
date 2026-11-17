import type { CloudProvider } from "./cloud.ts";

/**
 * Sync conflict copies of a doc: when two machines change one file before
 * they sync, the service keeps both and renames one. Anur offers each copy as
 * a merge into the original, section by section (Sync and Collaboration,
 * "Cloud folders"); it never merges or deletes on its own.
 *
 * - iCloud: `Notes 2.md` beside `Notes.md`. A person may also name a file
 *   that way, so this pattern is only offered in an iCloud folder, and the
 *   person decides.
 * - Dropbox: `Notes (conflicted copy 2026-11-17).md`, or with a name:
 *   `Notes (Sam's conflicted copy 2026-11-17).md`.
 */
export type ConflictCopy = { original: string; copy: string; service: "icloud" | "dropbox" };

const DROPBOX = /^(.*) \((?:[^()]*'s )?conflicted copy[^()]*\)\.md$/i;
const ICLOUD = /^(.*) ([2-9]|[1-9]\d)\.md$/i;

export function findConflictCopies(
  docs: readonly string[],
  provider: CloudProvider | null,
): ConflictCopy[] {
  const present = new Set(docs.map((d) => d.toLowerCase()));
  const out: ConflictCopy[] = [];
  for (const copy of docs) {
    const slash = copy.lastIndexOf("/");
    const dir = slash < 0 ? "" : copy.slice(0, slash + 1);
    const name = copy.slice(slash + 1);
    const dropbox = DROPBOX.exec(name);
    const icloud = provider === "icloud" ? ICLOUD.exec(name) : null;
    const base = dropbox?.[1] ?? icloud?.[1];
    if (!base) continue;
    const original = `${dir}${base}.md`;
    if (!present.has(original.toLowerCase())) continue;
    const match = docs.find((d) => d.toLowerCase() === original.toLowerCase()) ?? original;
    out.push({ original: match, copy, service: dropbox ? "dropbox" : "icloud" });
  }
  return out;
}
