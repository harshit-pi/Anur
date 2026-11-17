import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeDocPath } from "@anur/core";
import type { FolderState, Request, Response } from "../../shared/ipc-contract.ts";
import { writeFileAtomic } from "../../vault/anur-folder.ts";
import { decodeDoc, encodeDoc } from "../../vault/doc-file.ts";

/**
 * Saving the page (task 2.7). Every save is a compare-and-swap: the page
 * sends the hash of the bytes it last read or wrote, and the file is written
 * only if it still has them. Anything else means the file changed outside
 * Anur, and nothing on disk is overwritten. The file keeps its own line
 * endings and byte-order mark, and is replaced in one atomic step.
 */

export const hashBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

export async function saveDoc(
  folder: FolderState,
  request: Request<"doc:save">,
): Promise<Response<"doc:save">> {
  let rel: string;
  try {
    rel = normalizeDocPath(request.path);
  } catch (e) {
    return { kind: "failed", reason: (e as Error).message };
  }
  if (!folder.docs.includes(rel))
    return { kind: "failed", reason: `${rel} isn't a doc in this folder.` };
  if (folder.mode === "read-only") return { kind: "failed", reason: "This folder is read-only." };
  const file = path.join(folder.path, rel);
  try {
    const current = new Uint8Array(await readFile(file));
    if (hashBytes(current) !== request.base) return { kind: "changed" };
    const doc = decodeDoc(current);
    if (doc.mode !== "editable") {
      return { kind: "failed", reason: doc.note ?? `Anur doesn't write ${rel}.` };
    }
    const next = encodeDoc(request.text, doc);
    if (!sameBytes(next, current)) await writeFileAtomic(file, next);
    return { kind: "saved", hash: hashBytes(next) };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return { kind: "changed" };
    return { kind: "failed", reason: err.message };
  }
}
