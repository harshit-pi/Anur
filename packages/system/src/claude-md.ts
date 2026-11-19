import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { currentEntries, renderBlock, withBlock } from "@anur/core";

/**
 * The `CLAUDE.md` block for one repo (23.5), from its `.anur/decisions/`
 * files: as they are in the working tree, or, with `staged`, as they are
 * about to be committed, so the pre-commit hook (23.6) writes what the
 * commit holds and every Mac writes the same bytes.
 */

const DIR = ".anur/decisions";

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

/** Each person's decisions file, by whose it is. */
export function decisionFiles(repo: string, staged = false): { person: string; text: string }[] {
  const person = (f: string) => path.basename(f, ".jsonl");
  if (staged) {
    const listed = (git(repo, "ls-files", "--cached", "--", `${DIR}/*.jsonl`) ?? "")
      .split("\n")
      .filter(Boolean);
    return listed.map((f) => ({ person: person(f), text: git(repo, "show", `:${f}`) ?? "" }));
  }
  let names: string[];
  try {
    names = readdirSync(path.join(repo, DIR)).filter((n) => n.endsWith(".jsonl"));
  } catch {
    return [];
  }
  return names.sort().map((n) => ({
    person: person(n),
    text: (() => {
      try {
        return readFileSync(path.join(repo, DIR, n), "utf8");
      } catch {
        return "";
      }
    })(),
  }));
}

/**
 * The repo's `CLAUDE.md` with its block brought up to date: `next` is null
 * when the file needn't exist, and `changed` says whether it differs.
 */
export function claudeMdFor(
  repo: string,
  opts: { staged?: boolean } = {},
): { file: string; next: string | null; changed: boolean } {
  const file = path.join(repo, "CLAUDE.md");
  let now: string | null;
  try {
    now = readFileSync(file, "utf8");
  } catch {
    now = null;
  }
  const next = withBlock(now, renderBlock(currentEntries(decisionFiles(repo, opts.staged))));
  return { file, next, changed: next !== now };
}

/** Write the block into the repo's `CLAUDE.md` when it changed; whether it did. */
export function writeClaudeMd(repo: string, opts: { staged?: boolean } = {}): boolean {
  const { file, next, changed } = claudeMdFor(repo, opts);
  if (!changed || next === null) return false;
  writeFileSync(file, next);
  return true;
}
