import { stat } from "node:fs/promises";
import path from "node:path";
import { decideConflict, planConflictMerge } from "@anur/core";
import type { FolderState } from "../../shared/ipc-contract.ts";
import { readDoc, writeDoc } from "../../vault/doc-file.ts";

/**
 * Sync conflict copies ("Notes 2.md"), settled without asking, as Obsidian
 * asks nothing: a copy that adds nothing goes to the Trash, one that can be
 * folded in without losing a word is, and any other stays as a note of its own.
 */

export type SettleDeps = {
  /** Earlier versions of one section of a doc, from Anur's history. */
  history: (rel: string, text: string, sectionPath: readonly string[]) => Promise<string[]>;
  /** Whether Anur already keeps threads or history for this doc. */
  known: (rel: string) => Promise<boolean>;
  trash: (file: string) => Promise<void>;
  log: (message: string) => void;
};

/** Pairs left as two notes, by both files' size and time, so they aren't read again. */
const keptBoth = new Set<string>();

async function stamp(file: string): Promise<string> {
  const s = await stat(file);
  return `${String(s.size)}:${String(s.mtimeMs)}`;
}

/** Settles each conflict copy in the folder; true when any file changed. */
export async function settleConflicts(folder: FolderState, deps: SettleDeps): Promise<boolean> {
  if (folder.mode !== "writable") return false;
  let changed = false;
  for (const pair of folder.conflicts) {
    const original = path.join(folder.path, pair.original);
    const copy = path.join(folder.path, pair.copy);
    try {
      const keyNow = async () =>
        `${original}\u0000${await stamp(original)}\u0000${await stamp(copy)}`;
      const key = await keyNow();
      if (keptBoth.has(key)) continue;
      // A copy someone opened in Anur may carry threads or history of its own.
      if (await deps.known(pair.copy)) {
        keptBoth.add(key);
        continue;
      }
      const [a, b] = await Promise.all([readDoc(original), readDoc(copy)]);
      if (a.mode !== "editable" || b.mode !== "editable") {
        keptBoth.add(key);
        continue;
      }
      const differs = planConflictMerge(a.text, b.text).parts.filter((p) => p.kind === "differs");
      const known = new Map<string, string[]>();
      for (const p of differs)
        known.set(p.path.join("\u0000"), await deps.history(pair.original, a.text, p.path));
      const outcome = decideConflict(a.text, b.text, (p) => known.get(p.join("\u0000")) ?? []);
      // Either file changed while it was read: settle it on the next pass.
      if (key !== (await keyNow())) continue;
      if (outcome.kind === "keep-both") {
        keptBoth.add(key);
        deps.log(`kept ${pair.copy} beside ${pair.original}: ${outcome.why}`);
        continue;
      }
      if (outcome.kind === "write") await writeDoc(original, outcome.text, a);
      await deps.trash(copy);
      changed = true;
      deps.log(
        outcome.kind === "write"
          ? `folded ${pair.copy} into ${pair.original} (${outcome.why}); copy moved to the Trash`
          : `moved ${pair.copy} to the Trash: ${outcome.kind === "same" ? "same as the original" : outcome.why}`,
      );
    } catch (e) {
      deps.log(`left ${pair.copy} alone: ${(e as Error).message}`);
    }
  }
  return changed;
}
