import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FolderRead } from "./index-process/protocol.ts";

/**
 * The last read of a folder's system, saved in its `.anur/system/`, so the
 * System tab draws at once on launch while a fresh read runs (it's derived
 * from code, so a stale copy is only ever shown as "Updating…"). Kept per
 * set of plugins, and versioned so an older shape is never drawn.
 */
const VERSION = 1;
const file = (folder: string) => path.join(folder, ".anur", "system", "last-read.json");

export function saveRead(folder: string, plugins: string, read: FolderRead): void {
  try {
    const f = file(folder);
    mkdirSync(path.dirname(f), { recursive: true });
    // Written beside, then renamed, so a crash never leaves half a file.
    writeFileSync(`${f}.tmp`, JSON.stringify({ version: VERSION, plugins, at: Date.now(), read }));
    renameSync(`${f}.tmp`, f);
  } catch {
    // A read-only folder: the next launch reads afresh.
  }
}

export function loadRead(folder: string, plugins: string): FolderRead | null {
  try {
    const j = JSON.parse(readFileSync(file(folder), "utf8")) as {
      version?: unknown;
      plugins?: unknown;
      read?: FolderRead;
    };
    return j.version === VERSION && j.plugins === plugins && j.read ? j.read : null;
  } catch {
    return null;
  }
}
