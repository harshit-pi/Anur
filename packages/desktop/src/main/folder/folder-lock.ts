import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";

/**
 * One writer per folder on this machine (Architecture, "One writer per
 * folder"): opening a folder takes a lock in Anur's app-support folder, keyed
 * by the folder's real path, never in the vault. A lock left by a process
 * that crashed expires on its own: it names its process, and a process that
 * is gone holds nothing.
 */
export type LockHolder = { pid: number; host: string; folder: string; since: string };

export type LockResult =
  { ok: true; release: () => Promise<void> } | { ok: false; heldBy: LockHolder };

export function lockFileFor(appSupportDir: string, realFolder: string): string {
  const key = createHash("sha256").update(realFolder.normalize("NFC")).digest("hex").slice(0, 24);
  return path.join(appSupportDir, "locks", `${key}.json`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readHolder(file: string): Promise<LockHolder | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as LockHolder;
  } catch {
    return null;
  }
}

export async function acquireFolderLock(
  appSupportDir: string,
  realFolder: string,
  opts: { pid?: number; isAlive?: (pid: number) => boolean; now?: () => number } = {},
): Promise<LockResult> {
  const pid = opts.pid ?? process.pid;
  const isAlive = opts.isAlive ?? alive;
  const file = lockFileFor(appSupportDir, realFolder);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const me: LockHolder = {
    pid,
    host: hostname(),
    folder: realFolder,
    since: new Date(opts.now?.() ?? Date.now()).toISOString(),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await writeFile(file, JSON.stringify(me), { flag: "wx", mode: 0o600 });
      return {
        ok: true,
        release: async () => {
          const holder = await readHolder(file);
          if (holder?.pid === pid) await rm(file, { force: true });
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = await readHolder(file);
      if (holder && holder.pid !== pid && isAlive(holder.pid)) return { ok: false, heldBy: holder };
      // Left by a crashed process, unreadable, or our own: clear it and try again.
      await rm(file, { force: true });
    }
  }
  throw new Error(`couldn't take the lock for ${realFolder}`);
}
