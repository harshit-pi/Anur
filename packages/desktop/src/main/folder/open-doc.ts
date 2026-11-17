import path from "node:path";
import { normalizeDocPath } from "@anur/core";
import type { FolderState, Response } from "../../shared/ipc-contract.ts";
import { decodeDoc } from "../../vault/doc-file.ts";
import { readDocBytes } from "../../vault/icloud.ts";
import { hashBytes } from "./save-doc.ts";

/**
 * Open one of the folder's docs for the page. Only a doc the folder listed
 * can be opened, so a path from the page can't reach anything else.
 */
export async function openDoc(
  folder: FolderState,
  requested: string,
): Promise<Response<"doc:open">> {
  let rel: string;
  try {
    rel = normalizeDocPath(requested);
  } catch (e) {
    return { kind: "failed", reason: (e as Error).message };
  }
  if (!folder.docs.includes(rel))
    return { kind: "failed", reason: `${rel} isn't a doc in this folder.` };
  try {
    const bytes = await readDocBytes(path.join(folder.path, rel));
    const doc = decodeDoc(bytes);
    const readOnlyFolder = folder.mode === "read-only" && doc.mode === "editable";
    return {
      kind: "doc",
      path: rel,
      text: doc.text,
      mode: readOnlyFolder ? "read-only" : doc.mode,
      note: readOnlyFolder ? folder.reason : doc.note,
      hash: hashBytes(bytes),
    };
  } catch (e) {
    return { kind: "failed", reason: (e as Error).message };
  }
}
