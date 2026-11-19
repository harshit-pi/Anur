import { execFile } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

/** Folders a walk never enters: big, and nothing Anur reads. */
const SKIP = new Set([".git", "node_modules", ".Trash"]);

/**
 * Files iCloud has offloaded under `root`: they keep their size but hold no
 * blocks on disk, so reading one waits on a download.
 */
export async function offloadedIn(root: string, limit = 20_000): Promise<string[]> {
  const out: string[] = [];
  let seen = 0;
  const walk = async (dir: string): Promise<void> => {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (++seen > limit) return;
      if (SKIP.has(name)) continue;
      const at = path.join(dir, name);
      const s = await lstat(at).catch(() => null);
      if (!s) continue;
      if (s.isDirectory()) await walk(at);
      else if (s.isFile() && s.size > 0 && s.blocks === 0) out.push(at);
    }
  };
  await walk(root);
  return out;
}

/** Whether a folder syncs with iCloud Drive, where macOS offloads files when the disk runs low. */
export function inICloud(folder: string): boolean {
  return process.platform === "darwin" && folder.includes("/Library/Mobile Documents/");
}

/**
 * Ask iCloud to bring a folder's offloaded files back, in the background, so
 * opening a doc or starting a thread doesn't wait on each one. Resolves with how many were asked for.
 */
export async function fetchOffloaded(
  folder: string,
  run: (files: string[]) => Promise<void> = brctlDownload,
): Promise<number> {
  if (!inICloud(folder)) return 0;
  const files = await offloadedIn(folder);
  for (let i = 0; i < files.length; i += 200)
    await run(files.slice(i, i + 200)).catch(() => undefined);
  return files.length;
}

function brctlDownload(files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/brctl", ["download", ...files], { timeout: 30_000 }, (e) => {
      if (e) reject(new Error(e.message));
      else resolve();
    });
  });
}
