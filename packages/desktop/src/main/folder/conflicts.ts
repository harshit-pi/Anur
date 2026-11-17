import { createHash } from "node:crypto";
import path from "node:path";
import { applyMerge, normalizeDocPath, planConflictMerge, type MergeChoices } from "@anur/core";
import type { FolderState, Response } from "../../shared/ipc-contract.ts";
import { writeFileAtomic } from "../../vault/anur-folder.ts";
import { readDocText } from "../../vault/icloud.ts";

/**
 * Merging a sync conflict copy into its original (task 2.3). The person sees
 * the plan section by section and picks; the merge writes the original in
 * one atomic step, refuses if either file changed since the plan, and moves
 * the copy to the Trash, never deleting it outright.
 */
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function pairFor(folder: FolderState, copy: string) {
  const norm = normalizeDocPath(copy);
  const pair = folder.conflicts.find((c) => c.copy === norm);
  if (!pair) throw new Error(`${copy} is not a conflict copy in this folder`);
  return {
    original: path.join(folder.path, pair.original),
    copy: path.join(folder.path, pair.copy),
    pair,
  };
}

export async function planConflict(
  folder: FolderState,
  copy: string,
): Promise<Response<"conflict:plan">> {
  try {
    const files = pairFor(folder, copy);
    const [original, copyText] = await Promise.all([
      readDocText(files.original),
      readDocText(files.copy),
    ]);
    const plan = planConflictMerge(original, copyText);
    return {
      kind: "plan",
      original: files.pair.original,
      copy: files.pair.copy,
      parts: plan.parts,
      hashes: { original: hash(original), copy: hash(copyText) },
    };
  } catch (e) {
    return { kind: "failed", reason: (e as Error).message };
  }
}

export async function mergeConflict(
  folder: FolderState,
  request: {
    copy: string;
    hashes: { original: string; copy: string };
    choices: Record<string, "original" | "copy" | boolean>;
  },
  trash: (file: string) => Promise<void>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const files = pairFor(folder, request.copy);
    const [original, copyText] = await Promise.all([
      readDocText(files.original),
      readDocText(files.copy),
    ]);
    if (hash(original) !== request.hashes.original || hash(copyText) !== request.hashes.copy) {
      return {
        ok: false,
        reason: "One of the two files changed since you reviewed the merge. Review it again.",
      };
    }
    const choices: MergeChoices = Object.fromEntries(
      Object.entries(request.choices).map(([k, v]) => [Number(k), v]),
    );
    await writeFileAtomic(
      files.original,
      applyMerge(planConflictMerge(original, copyText), choices),
    );
    await trash(files.copy);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
