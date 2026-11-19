import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ANUR_DIR, anurPaths } from "@anur/core";
import { writeFileAtomic } from "../../vault/anur-folder.ts";
import { findHomes } from "./homes.ts";

/**
 * Spaces (see docs/anur-folder.md). A space is the folder a window works in:
 * it gathers every `.anur/` inside it, its repos' included, and its plugins and
 * Git act on it alone. What makes one is `.anur/space.json`, never just a
 * `.anur/`: every repo has a `.anur/`, and a repo can be a space on one Mac and
 * a part of `~/workspace` on another. So the marker stays on each Mac, out of
 * git, and no space ever sits inside another.
 */

const marker = (dir: string) => path.join(dir, ANUR_DIR, anurPaths.space());

export async function isSpace(dir: string): Promise<boolean> {
  return stat(marker(dir)).then(
    (s) => s.isFile(),
    () => false,
  );
}

/** The space `folder` is in: itself, or the nearest folder above it marked as one; else null. */
export async function spaceAbove(folder: string): Promise<string | null> {
  let dir = path.resolve(folder);
  for (;;) {
    if (await isSpace(dir)) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Makes `root` a space on this Mac. Any space inside it stops being one, as
 * the parent takes over (2026-11-19): only its marker goes. Its threads,
 * decisions and settings stay where they are, read by the parent as part of
 * it, and come back to life if it's opened on its own again. Returns the
 * spaces taken over, as paths from `root`.
 */
export async function markSpace(root: string, now = new Date()): Promise<string[]> {
  const taken: string[] = [];
  for (const home of await findHomes(root)) {
    const inner = path.join(root, home);
    if (!(await isSpace(inner))) continue;
    await rm(marker(inner), { force: true });
    taken.push(home);
  }
  if (!(await isSpace(root))) {
    await mkdir(path.join(root, ANUR_DIR), { recursive: true });
    await writeFileAtomic(marker(root), `${JSON.stringify({ since: now.toISOString() })}\n`);
  }
  return taken;
}

/** Of `folders` (most recent first), the ones that are spaces on this Mac now. */
export async function spacesIn(folders: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of folders) if (await isSpace(f)) out.push(f);
  return out;
}

/** Whether a space syncs with GitHub: its own repo has a github.com remote. */
export async function onGitHub(root: string): Promise<boolean> {
  const config = await readFile(path.join(root, ".git", "config"), "utf8").catch(() => "");
  return /url\s*=\s*.*github\.com[:/]/.test(config);
}
