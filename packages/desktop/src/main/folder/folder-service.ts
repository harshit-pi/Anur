import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { cloudProviderOf, findConflictCopies } from "@anur/core";
import type { FolderState } from "../../shared/ipc-contract.ts";
import { openAnurFolder } from "../../vault/anur-folder.ts";
import { listOffloaded } from "../../vault/icloud.ts";
import { acquireFolderLock, type LockHolder } from "./folder-lock.ts";
import { docTimes, listDocs } from "./list-docs.ts";
import { rememberFolder } from "./recent.ts";
import { markVault, vaultAbove } from "./vaults.ts";

export type OpenOutcome =
  /** `inside`: the folder asked for, from the vault it's part of, when that vault opened instead. */
  | { kind: "opened"; folder: FolderState; inside?: string }
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

  constructor(
    private readonly appSupportDir: string,
    private readonly home: string = homedir(),
    /** Where folder locks live; shared by Anur and Anur Dev, so one can't open what the other holds. */
    private readonly lockDir: string = appSupportDir,
  ) {}

  current(windowId: number): FolderState | null {
    return this.byWindow.get(windowId)?.state ?? null;
  }

  windowFor(realFolder: string): number | null {
    for (const [id, open] of this.byWindow) if (open.state.path === realFolder) return id;
    return null;
  }

  async open(windowId: number, chosen: string): Promise<OpenOutcome> {
    let asked: string;
    try {
      asked = await realpath(chosen);
    } catch {
      return {
        kind: "refused",
        reason: `${chosen} can't be opened: it doesn't exist or can't be read.`,
      };
    }
    // A folder inside a vault opens that vault, so nothing is ever a smaller vault of its own.
    const folder = (await vaultAbove(asked)) ?? asked;
    const inside = folder === asked ? undefined : path.relative(folder, asked);
    const other = this.windowFor(folder);
    if (other !== null) return { kind: "elsewhere", windowId: other };

    const lock = await acquireFolderLock(this.lockDir, folder);
    if (!lock.ok) return { kind: "refused", reason: heldMessage(lock.heldBy) };

    try {
      const anur = await openAnurFolder(folder);
      // Opened, it's a vault; one inside it stops being one, as this takes over. The marker
      // is written at once; the walk for vaults inside runs after, so opening never waits on it.
      if (anur.mode === "writable") await markVault(folder, new Date(), "later");
      const state = await this.describe(folder, anur.mode === "read-only" ? anur.reason : null);
      await this.close(windowId);
      this.byWindow.set(windowId, { state, release: lock.release });
      await rememberFolder(this.appSupportDir, folder);
      return inside ? { kind: "opened", folder: state, inside } : { kind: "opened", folder: state };
    } catch (e) {
      await lock.release();
      return { kind: "refused", reason: `${folder} couldn't be opened: ${(e as Error).message}` };
    }
  }

  /** What the sidebar and banners need to know about a folder, read fresh from disk. */
  private async describe(folder: string, readOnlyReason: string | null): Promise<FolderState> {
    const { docs, truncated, folders, files } = await listDocs(folder);
    const cloud = cloudProviderOf(folder, this.home);
    const gitInCloud =
      cloud !== null &&
      (await stat(path.join(folder, ".git")).then(
        () => true,
        () => false,
      ));
    return {
      name: path.basename(folder),
      path: folder,
      mode: readOnlyReason ? "read-only" : "writable",
      reason: readOnlyReason,
      docs,
      folders,
      files,
      times: await docTimes(folder, [...docs, ...files]),
      truncated,
      cloud,
      gitInCloud,
      offloaded: cloud === "icloud" ? await listOffloaded(folder) : [],
      conflicts: findConflictCopies(docs, cloud),
    };
  }

  /** Read a window's folder again, as after a merge changed its files. */
  async refresh(windowId: number): Promise<FolderState | null> {
    const open = this.byWindow.get(windowId);
    if (!open) return null;
    open.state = await this.describe(open.state.path, open.state.reason);
    return open.state;
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
