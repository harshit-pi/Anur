import { realpath } from "node:fs/promises";
import path from "node:path";
import type { FolderState } from "../../shared/ipc-contract.ts";
import { openAnurFolder } from "../../vault/anur-folder.ts";
import { acquireFolderLock, type LockHolder } from "./folder-lock.ts";
import { listDocs } from "./list-docs.ts";
import { rememberFolder } from "./recent.ts";

export type OpenOutcome =
  | { kind: "opened"; folder: FolderState }
  | { kind: "elsewhere"; windowId: number }
  | { kind: "refused"; reason: string };

type Open = { state: FolderState; release: () => Promise<void> };

/**
 * Which folder each window has open. One folder per window and one window
 * per folder: opening a folder that is already open points at its window,
 * and a folder another copy of Anur holds is refused.
 */
export class FolderService {
  private readonly byWindow = new Map<number, Open>();

  constructor(private readonly appSupportDir: string) {}

  current(windowId: number): FolderState | null {
    return this.byWindow.get(windowId)?.state ?? null;
  }

  windowFor(realFolder: string): number | null {
    for (const [id, open] of this.byWindow) if (open.state.path === realFolder) return id;
    return null;
  }

  async open(windowId: number, chosen: string): Promise<OpenOutcome> {
    let folder: string;
    try {
      folder = await realpath(chosen);
    } catch {
      return {
        kind: "refused",
        reason: `${chosen} can't be opened: it doesn't exist or can't be read.`,
      };
    }
    const other = this.windowFor(folder);
    if (other !== null) return { kind: "elsewhere", windowId: other };

    const lock = await acquireFolderLock(this.appSupportDir, folder);
    if (!lock.ok) return { kind: "refused", reason: heldMessage(lock.heldBy) };

    try {
      const anur = await openAnurFolder(folder);
      const { docs, truncated } = await listDocs(folder);
      const state: FolderState = {
        name: path.basename(folder),
        path: folder,
        mode: anur.mode,
        reason: anur.mode === "read-only" ? anur.reason : null,
        docs,
        truncated,
      };
      await this.close(windowId);
      this.byWindow.set(windowId, { state, release: lock.release });
      await rememberFolder(this.appSupportDir, folder);
      return { kind: "opened", folder: state };
    } catch (e) {
      await lock.release();
      return { kind: "refused", reason: `${folder} couldn't be opened: ${(e as Error).message}` };
    }
  }

  /** Release a window's folder, as when the window closes. */
  async close(windowId: number): Promise<void> {
    const open = this.byWindow.get(windowId);
    if (!open) return;
    this.byWindow.delete(windowId);
    await open.release();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.byWindow.keys()].map((id) => this.close(id)));
  }
}

function heldMessage(holder: LockHolder): string {
  return `${holder.folder} is already open in another copy of Anur on this Mac (process ${String(holder.pid)}, since ${holder.since}). Close it there first.`;
}
