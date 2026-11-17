import type { FolderState } from "../../../shared/ipc-contract.ts";

/**
 * What Anur says about a folder that a sync service manages. The notice shows
 * once per folder; after the person dismisses it, the same words live behind
 * the status bar's quiet "iCloud Drive" item. Remembered per device, in the
 * page's own storage, never in the vault.
 */
export const PROVIDERS: Record<NonNullable<FolderState["cloud"]>, string> = {
  icloud: "iCloud Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  "google-drive": "Google Drive",
  cloud: "a cloud folder",
};

type CloudFolder = Pick<FolderState, "cloud" | "offloaded" | "gitInCloud">;

/** The notice's sentences, or null for a folder no sync service manages. */
export function cloudSummary(folder: CloudFolder): string[] | null {
  if (!folder.cloud) return null;
  const lines = [
    `This folder syncs through ${PROVIDERS[folder.cloud]}. Anur keeps its caches and its lock on this Mac, outside the folder.`,
  ];
  const n = folder.offloaded.length;
  if (n > 0) {
    lines.push(
      `${String(n)} ${n === 1 ? "doc is" : "docs are"} still in iCloud; Anur downloads each one before opening it.`,
    );
  }
  if (folder.gitInCloud) {
    lines.push(
      "It is also a git repo: sync can break git's lock files, so a repo is safer outside a synced folder.",
    );
  }
  return lines;
}

const KEY = "anur.cloudNoticeSeen";

function seenPaths(storage: Pick<Storage, "getItem"> | undefined): string[] {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function noticeSeen(storage: Pick<Storage, "getItem"> | undefined, folder: string): boolean {
  return seenPaths(storage).includes(folder);
}

export function markNoticeSeen(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  folder: string,
): void {
  try {
    const seen = seenPaths(storage).filter((p) => p !== folder);
    // The most recent folders, so the list can't grow without bound.
    storage?.setItem(KEY, JSON.stringify([folder, ...seen].slice(0, 200)));
  } catch {
    // Storage blocked or full: the notice just shows again next time.
  }
}
