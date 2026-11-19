import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ANUR_DIR, anurPaths } from "@anur/core";
import { writeFileAtomic } from "../../vault/anur-folder.ts";
import { findHomes } from "./homes.ts";

/**
 * Vaults (see docs/anur-folder.md). A vault is the folder a window works in:
 * it gathers every `.anur/` inside it, its repos' included, and its plugins and
 * Git act on it alone. What makes one is `.anur/vault.json`, never just a
 * `.anur/`: every repo has a `.anur/`, and a repo can be a vault on one Mac and
 * a part of `~/workspace` on another. So the marker stays on each Mac, out of
 * git, and no vault ever sits inside another.
 */

const marker = (dir: string) => path.join(dir, ANUR_DIR, anurPaths.vault());

export async function isVault(dir: string): Promise<boolean> {
  return stat(marker(dir)).then(
    (s) => s.isFile(),
    () => false,
  );
}

/** The vault `folder` is in: itself, or the nearest folder above it marked as one; else null. */
export async function vaultAbove(folder: string): Promise<string | null> {
  let dir = path.resolve(folder);
  for (;;) {
    if (await isVault(dir)) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Makes `root` a vault on this Mac. Any vault inside it stops being one, as
 * the parent takes over (2026-11-19): only its marker goes. Its threads,
 * decisions and settings stay where they are, read by the parent as part of
 * it, and come back to life if it's opened on its own again. Returns the
 * vaults taken over, as paths from `root`.
 */
export async function markVault(root: string, now = new Date()): Promise<string[]> {
  const taken: string[] = [];
  for (const home of await findHomes(root)) {
    const inner = path.join(root, home);
    if (!(await isVault(inner))) continue;
    await rm(marker(inner), { force: true });
    taken.push(home);
  }
  if (!(await isVault(root))) {
    await mkdir(path.join(root, ANUR_DIR), { recursive: true });
    await writeFileAtomic(marker(root), `${JSON.stringify({ since: now.toISOString() })}\n`);
  }
  return taken;
}

/** Of `folders` (most recent first), the ones that are vaults on this Mac now. */
export async function vaultsIn(folders: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of folders) if (await isVault(f)) out.push(f);
  return out;
}

/** Whether a vault syncs with GitHub: its own repo has a github.com remote. */
export async function onGitHub(root: string): Promise<boolean> {
  const config = await readFile(path.join(root, ".git", "config"), "utf8").catch(() => "");
  return /url\s*=\s*.*github\.com[:/]/.test(config);
}
