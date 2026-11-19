import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { githubOf } from "@anur/system";

const run = promisify(execFile);

/**
 * Threads in a public repo (18.13). `.anur/` is committed by default,
 * threads included, so in a repo anyone can read on GitHub they'd be
 * published on the next push. Anur asks once, before that happens.
 */

async function git(dir: string, ...args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await run("git", ["-C", dir, ...args], { timeout: 5000 });
    return { ok: true, out: stdout.trim() };
  } catch {
    return { ok: false, out: "" };
  }
}

/**
 * Whether git would commit this folder's threads: it's in a repo and
 * nothing ignores `.anur/docs/`, neither the folder's `.anur/.gitignore`
 * nor the repo's own. Asked of git itself, so every ignore rule counts.
 */
export async function threadsCommitted(folder: string): Promise<boolean> {
  if (!(await git(folder, "rev-parse", "--is-inside-work-tree")).ok) return false;
  // check-ignore succeeds when the path is ignored.
  return !(await git(folder, "check-ignore", "-q", ".anur/docs/thread.jsonl")).ok;
}

/** Public on GitHub: true or false, or null when it can't be told (offline, no `gh`). */
export type Visibility = (repo: string) => Promise<boolean | null>;

/** Asks `gh` first, signed in or not, then GitHub's public API, which answers only for public repos. */
export const githubVisibility: Visibility = async (repo) => {
  try {
    const { stdout } = await run("gh", ["api", `repos/${repo}`, "--jq", ".private"], {
      timeout: 5000,
    });
    if (stdout.trim() === "false") return true;
    if (stdout.trim() === "true") return false;
  } catch {
    // No gh, or not signed in: try the public API.
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "Anur" },
      signal: AbortSignal.timeout(5000),
    });
    if (r.status === 404) return false;
    if (!r.ok) return null;
    const body = (await r.json()) as { private?: unknown };
    return body.private === false;
  } catch {
    return null;
  }
};

/** The "owner/name" of this folder's public GitHub repo, when its threads would be committed to it. */
export async function publicRepoFor(
  folder: string,
  visibility: Visibility = githubVisibility,
): Promise<string | null> {
  if (!(await threadsCommitted(folder))) return null;
  const repo = githubOf((await git(folder, "remote", "get-url", "origin")).out || null);
  if (!repo) return null;
  return (await visibility(repo)) === true ? repo : null;
}
