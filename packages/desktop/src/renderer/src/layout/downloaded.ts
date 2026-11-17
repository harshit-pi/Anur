import type { FolderState } from "../../../shared/ipc-contract.ts";

/**
 * Docs that came down from iCloud since the folder was listed. The folder's
 * list of cloud-only docs is taken when it opens; once a doc opens, its bytes
 * are on this Mac, so it stops being shown as cloud-only. Main still checks
 * each file's real state when opening it, so a doc iCloud removes again is
 * fetched again, whatever this says.
 */
export type Downloaded = { folder: string | null; docs: ReadonlySet<string> };

export const noneDownloaded: Downloaded = { folder: null, docs: new Set() };

/** The set after `doc` opened in `folder`; a different folder starts a new set. */
export function markDownloaded(d: Downloaded, folder: string, doc: string): Downloaded {
  if (d.folder === folder && d.docs.has(doc)) return d;
  const docs = d.folder === folder ? new Set([...d.docs, doc]) : new Set([doc]);
  return { folder, docs };
}

export function isDownloaded(d: Downloaded, folder: string, doc: string): boolean {
  return d.folder === folder && d.docs.has(doc);
}

/** The folder as it now stands: docs opened since listing aren't cloud-only. */
export function withDownloaded<F extends Pick<FolderState, "path" | "offloaded">>(
  folder: F,
  d: Downloaded,
): F {
  if (d.folder !== folder.path || d.docs.size === 0) return folder;
  const offloaded = folder.offloaded.filter((p) => !d.docs.has(p));
  return offloaded.length === folder.offloaded.length ? folder : { ...folder, offloaded };
}
