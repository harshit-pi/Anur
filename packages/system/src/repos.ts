/**
 * Repos in a folder (group 20; Design - Engineering Plugin, §4, and
 * Internals, §1). Headless: node built-ins only, so the app, the pre-commit
 * hook and CI share it.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/** Folders never walked: dependencies, build output, Anur's own data. */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "cdk.out",
  "dist",
  "build",
  ".next",
  ".anur",
  ".venv",
  "venv",
  "target",
  "__pycache__",
]);

export type Repo = {
  /** Folder relative to the opened folder; "." when the folder is itself a repo. */
  dir: string;
  /** The oldest root commit's hash, from anur/repo.json or git; null when it can't be known. */
  id: string | null;
  /** "owner/name" when origin is on GitHub. */
  github: string | null;
  /** Origin's URL, or null without a remote. */
  remote: string | null;
};

export type ScanProblem = { where: string; what: string };

/** Every repo inside `folder`, at any depth; a repo inside a repo (a submodule) is its own. */
export function findRepoDirs(folder: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    if (names.includes(".git")) out.push(path.relative(folder, dir) || ".");
    for (const n of names) {
      if (SKIP_DIRS.has(n) || n.startsWith(".")) continue;
      const p = path.join(dir, n);
      try {
        if (statSync(p).isDirectory()) walk(p);
      } catch {
        // A broken link or a folder we can't read: skipped.
      }
    }
  };
  walk(folder);
  return out.sort();
}

/** The .git folder, following a worktree's or submodule's "gitdir:" file. */
function gitDir(repo: string): string {
  const g = path.join(repo, ".git");
  try {
    if (statSync(g).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(g, "utf8"));
      if (m?.[1]) return path.resolve(repo, m[1].trim());
    }
  } catch {
    // Missing: handled by callers.
  }
  return g;
}

/** Origin's URL from .git/config, read as text so no git is needed. */
export function originOf(repo: string): string | null {
  let cfg: string;
  try {
    cfg = readFileSync(path.join(gitDir(repo), "config"), "utf8");
  } catch {
    return null;
  }
  const block = /\[remote "origin"\]([\s\S]*?)(?=\n\[|$)/.exec(cfg)?.[1] ?? "";
  return /^\s*url\s*=\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null;
}

/** "owner/name" for a GitHub URL, in https or ssh form. */
export function githubOf(url: string | null): string | null {
  if (!url) return null;
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  return m ? `${m[1] ?? ""}/${m[2] ?? ""}` : null;
}

const REPO_FILE = path.join("anur", "repo.json");

/**
 * A repo's ID: the oldest root commit's hash. Read from the committed
 * anur/repo.json when it exists, so shallow clones and CI agree; otherwise
 * from git, and written there when `pin` is set. A shallow clone without the
 * file has no ID: it can't see its first commit.
 */
export function repoIdOf(
  repo: string,
  pin: boolean,
  problems: ScanProblem[],
  where: string,
): string | null {
  const file = path.join(repo, REPO_FILE);
  if (existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, "utf8")) as { id?: unknown };
      if (typeof j.id === "string" && /^[0-9a-f]{40}$/.test(j.id)) return j.id;
    } catch {
      // Falls through to the problem below.
    }
    problems.push({ where, what: "anur/repo.json can't be read; its ID is worked out again" });
  }
  if (existsSync(path.join(gitDir(repo), "shallow"))) {
    problems.push({
      where,
      what: "A shallow clone without anur/repo.json: commit that file from a full clone to give it an ID",
    });
    return null;
  }
  let roots: string;
  try {
    roots = execFileSync("git", ["log", "--max-parents=0", "--format=%ct %H", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    problems.push({ where, what: "No commits yet, so no ID until the first commit" });
    return null;
  }
  // Several roots (merged histories): the oldest by commit date, then by hash.
  const oldest = roots
    .trim()
    .split("\n")
    .map((l) => l.split(" "))
    .filter((p): p is [string, string] => p.length === 2)
    .sort((a, b) => Number(a[0]) - Number(b[0]) || a[1].localeCompare(b[1]))[0]?.[1];
  if (!oldest) return null;
  if (pin) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ id: oldest }, null, 2)}\n`);
  }
  return oldest;
}

/**
 * The repos in a folder. Two clones of one repo are kept once, with a
 * warning: the one whose folder is named as on GitHub, else the shortest path.
 */
export function findRepos(
  folder: string,
  opts: { pin?: boolean } = {},
): { repos: Repo[]; problems: ScanProblem[] } {
  const problems: ScanProblem[] = [];
  const all: Repo[] = [];
  for (const dir of findRepoDirs(folder)) {
    const abs = path.join(folder, dir);
    const id = repoIdOf(abs, opts.pin ?? false, problems, dir);
    const remote = originOf(abs);
    all.push({ dir, id, github: githubOf(remote), remote });
  }
  // Lower is better: named as on GitHub, then fewer folders deep, then a shorter path.
  const rank = (r: Repo): number[] => [
    r.github?.split("/")[1] === path.basename(r.dir) ? 0 : 1,
    r.dir.split("/").length,
    r.dir.length,
  ];
  const better = (a: Repo, b: Repo) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (x[i] ?? 0) < (y[i] ?? 0);
    return a.dir < b.dir;
  };
  const best = new Map<string, Repo>();
  for (const r of all) {
    if (!r.id) continue;
    const b = best.get(r.id);
    if (!b || better(r, b)) best.set(r.id, r);
  }
  const repos = all.filter((r) => !r.id || best.get(r.id) === r);
  for (const r of all)
    if (r.id && best.get(r.id) !== r)
      problems.push({
        where: r.dir,
        what: `A second clone of ${best.get(r.id)?.dir ?? ""}; shown once`,
      });
  return { repos, problems };
}

/** A short stable hash, for part IDs. */
export const shortHash = (...parts: string[]) =>
  createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
