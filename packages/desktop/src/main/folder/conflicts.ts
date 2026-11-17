import { createHash } from "node:crypto";
import path from "node:path";
import { applyMerge, normalizeDocPath, planConflictMerge, type MergeChoices } from "@anur/core";
import type { FolderState, Response } from "../../shared/ipc-contract.ts";
import { readDoc, writeDoc, type DocFile } from "../../vault/doc-file.ts";

/**
 * Merging a sync conflict copy into its original (task 2.3). The person sees
 * the plan section by section and picks; the merge writes the original in
 * one atomic step, with its own line endings and byte-order mark, refuses if
 * either file changed since the plan, and moves the copy to the Trash, never
 * deleting it outright. A file Anur can't write safely, such as one that
 * isn't UTF-8, is never merged.
 */

/** Fingerprints a file as written: its text, line ending and byte-order mark. */
const hash = (doc: DocFile) =>
  createHash("sha256")
    .update(`${doc.eol}\u0000${String(doc.bom)}\u0000${doc.text}`)
    .digest("hex");

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

/** Both files, decoded; refuses either one Anur can't write safely. */
async function readPair(files: { original: string; copy: string }) {
  const [original, copy] = await Promise.all([readDoc(files.original), readDoc(files.copy)]);
  for (const [doc, file] of [
    [original, files.original],
    [copy, files.copy],
  ] as const) {
    if (doc.mode !== "editable") {
      throw new Error(`${path.basename(file)}: ${doc.note ?? "Anur can't merge it"}`);
    }
  }
  return { original, copy };
}

export async function planConflict(
  folder: FolderState,
  copy: string,
): Promise<Response<"conflict:plan">> {
  try {
    const files = pairFor(folder, copy);
    const docs = await readPair(files);
    const plan = planConflictMerge(docs.original.text, docs.copy.text);
    return {
      kind: "plan",
      original: files.pair.original,
      copy: files.pair.copy,
      parts: plan.parts,
      hashes: { original: hash(docs.original), copy: hash(docs.copy) },
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
    const docs = await readPair(files);
    if (
      hash(docs.original) !== request.hashes.original ||
      hash(docs.copy) !== request.hashes.copy
    ) {
      return {
        ok: false,
        reason: "One of the two files changed since you reviewed the merge. Review it again.",
      };
    }
    const choices: MergeChoices = Object.fromEntries(
      Object.entries(request.choices).map(([k, v]) => [Number(k), v]),
    );
    const merged = applyMerge(planConflictMerge(docs.original.text, docs.copy.text), choices);
    await writeDoc(files.original, merged, docs.original);
    await trash(files.copy);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
