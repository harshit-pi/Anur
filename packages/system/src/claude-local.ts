import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  currentEntries,
  renderBlock,
  withBlock,
  type BlockKind,
  type CommittedEntry,
} from "@anur/core";
import { decisionFiles } from "./claude-md.ts";
import { edgesIn } from "./edges.ts";
import { repoIdsOf, scanSystem } from "./system.ts";

/**
 * A person's own decisions not yet on the default branch, in their
 * `CLAUDE.local.md` (23.9): Claude Code reads it in every session, so a
 * decision reaches the person's next session at once, not only after it's
 * merged into the team's `CLAUDE.md`. The file is git-ignored through
 * `.git/info/exclude`, which no one else sees, and it's written only once git
 * confirms it's ignored, so it can never be committed by accident.
 */

const LOCAL = "CLAUDE.local.md";

function git(repo: string, ...args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** The default branch to compare against: origin's HEAD, else main or master; null when none. */
export function defaultRef(repo: string): string | null {
  const head = git(repo, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD")
    ?.trim()
    .replace(/^refs\/remotes\//, "");
  const candidates = [head, "origin/main", "origin/master", "main", "master"];
  for (const c of candidates)
    if (c && git(repo, "rev-parse", "--verify", "--quiet", `${c}^{commit}`) !== null) return c;
  return null;
}

/** The decisions and findings on a branch, as committed there. */
export function entriesAt(repo: string, ref: string): CommittedEntry[] {
  const files = (git(repo, "ls-tree", "--name-only", ref, ".anur/decisions/") ?? "")
    .split("\n")
    .filter((f) => f.endsWith(".jsonl"));
  return currentEntries(
    files.map((f) => ({
      person: path.basename(f, ".jsonl"),
      text: git(repo, "show", `${ref}:${f}`) ?? "",
    })),
  );
}

/** Kept here but not yet on the default branch. */
export function unmergedEntries(repo: string): CommittedEntry[] {
  const here = currentEntries(decisionFiles(repo));
  const ref = defaultRef(repo);
  if (!ref) return here;
  const merged = new Set(entriesAt(repo, ref).map((e) => e.id));
  return here.filter((e) => !merged.has(e.id));
}

/** Make sure git ignores `CLAUDE.local.md` here; whether it does. */
export function ignoreLocal(repo: string): boolean {
  const ignored = () => git(repo, "check-ignore", "-q", LOCAL) !== null;
  if (ignored()) return true;
  const exclude = git(repo, "rev-parse", "--git-path", "info/exclude")?.trim();
  if (!exclude) return false;
  const file = path.resolve(repo, exclude);
  mkdirSync(path.dirname(file), { recursive: true });
  let now = "";
  try {
    now = readFileSync(file, "utf8");
  } catch {
    // No exclude file yet.
  }
  appendFileSync(
    file,
    `${now && !now.endsWith("\n") ? "\n" : ""}# Anur: your own decisions not yet merged\n/${LOCAL}\n`,
  );
  return ignored();
}

/**
 * Bring `CLAUDE.local.md` up to date with the decisions not yet merged:
 * written, rewritten or taken out; the person's own text in it is kept.
 * Whether it changed.
 */
export function writeLocalMd(repo: string): boolean {
  if (git(repo, "rev-parse", "--is-inside-work-tree") === null) return false;
  return writeLocalBlock(repo, renderBlock(unmergedEntries(repo), "local"), "local");
}

/** One of Anur's blocks in `CLAUDE.local.md`, the rest of the file kept; whether it changed. */
function writeLocalBlock(repo: string, block: string | null, kind: BlockKind): boolean {
  const file = path.join(repo, LOCAL);
  let now: string | null;
  try {
    now = readFileSync(file, "utf8");
  } catch {
    now = null;
  }
  const next = withBlock(now, block, kind);
  if (next === now) return false;
  if (next === null || next === "" || !next.trim()) {
    rmSync(file, { force: true });
    return now !== null;
  }
  // Never written where git would commit it.
  if (!ignoreLocal(repo)) return false;
  writeFileSync(file, next);
  return true;
}

/**
 * Decisions on calls between repos, at the other end too (23.10): a
 * decision on a call is kept in the repo the person worked in, so the repo
 * at the other end of the call lists it in its own `CLAUDE.local.md`, for
 * every session there on this Mac. Only a system folder knows both ends;
 * each repo's own `CLAUDE.md` lists only its own. The repos written.
 */
export function writeEdgeSides(folder: string): string[] {
  const scan = scanSystem(folder);
  const edges = edgesIn(
    folder,
    scan.repos.map((r) => r.dir),
    scan.parts,
    repoIdsOf(scan),
  );
  const ends = new Map<string, string[]>();
  for (const e of edges) if ("repo" in e.to) ends.set(e.id, [e.from.repo, e.to.repo]);
  const kept = scan.repos.flatMap((r) =>
    currentEntries(decisionFiles(path.join(folder, r.dir))).map((e) => ({ ...e, home: r.dir })),
  );
  const written: string[] = [];
  for (const r of scan.repos) {
    const others = kept.filter((e) => {
      if (e.home === r.dir || !e.scope.startsWith("edge:")) return false;
      return ends.get(e.scope.slice("edge:".length))?.includes(r.dir) ?? false;
    });
    const repo = path.join(folder, r.dir);
    // A repo with nothing to list and no file yet is left alone.
    if (!others.length && !existsSync(path.join(repo, LOCAL))) continue;
    if (writeLocalBlock(repo, renderBlock(others, "edges"), "edges")) written.push(r.dir);
  }
  return written;
}
