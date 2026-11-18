import { readFile } from "node:fs/promises";
import path from "node:path";
import { docsBefore, rewriteLinks, type Move } from "@anur/core";
import type { FolderState } from "../../shared/ipc-contract.ts";

/**
 * The docs whose links a rename or move broke, with their text written
 * again. Docs still in iCloud are left out, so counting never downloads them.
 */
export type LinkChange = { rel: string; was: string; text: string; next: string; links: number };

export async function planLinkUpdates(
  folder: FolderState,
  moves: readonly Move[],
): Promise<LinkChange[]> {
  if (moves.length === 0) return [];
  const before = docsBefore(folder.docs, moves);
  const wasOf = new Map(moves.map((m) => [m.to, m.from]));
  const cloud = new Set(folder.offloaded);
  const changes: LinkChange[] = [];
  for (const rel of folder.docs) {
    if (cloud.has(rel)) continue;
    const text = await readFile(path.join(folder.path, rel), "utf8").catch(() => null);
    // Most docs link to nothing that moved: skip the parse unless a [ is there at all.
    if (text === null || !text.includes("[")) continue;
    const was = wasOf.get(rel) ?? rel;
    const r = rewriteLinks(text, was, rel, moves, before, folder.docs);
    if (r.changed > 0) changes.push({ rel, was, text, next: r.text, links: r.changed });
  }
  return changes;
}
