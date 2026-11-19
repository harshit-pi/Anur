import { execFileSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { renderBlock, withBlock } from "@anur/core";
import { entriesAt } from "./claude-local.ts";

/**
 * Anur's pre-commit step (23.6, 23.7): a few marked lines in a repo's
 * pre-commit hook that rebuild the `CLAUDE.md` block from the staged
 * decisions, so a commit from a terminal, or with Anur closed, still writes
 * it. The lines call a script at a fixed place, which the app keeps pointing
 * at itself, so they read the same on every Mac and in a committed hook;
 * someone without Anur skips them. They never stop a commit.
 *
 * Joins what's there, never replacing it: with husky, its own
 * `.husky/pre-commit` (its `_` folder is generated); with another
 * `core.hooksPath`, that folder's hook; else `.git/hooks/pre-commit`.
 */

export const HOOK_BEGIN = "# anur:pre-commit begin";
export const HOOK_END = "# anur:pre-commit end";
/** Where the app keeps its pre-commit script, the same path on every Mac. */
export const SHIM = "$HOME/.anur/bin/anur-pre-commit";

export const HOOK_LINES = [
  HOOK_BEGIN,
  "# Anur: the CLAUDE.md block from the staged decisions; never stops a commit.",
  `[ -x "${SHIM}" ] && "${SHIM}" || true`,
  HOOK_END,
].join("\n");

function git(repo: string, ...args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** The hook file Anur's lines belong in, and which kind of setup it is. */
export function hookFileFor(repo: string): { file: string; kind: "git" | "hooks-path" | "husky" } {
  const hooksPath = git(repo, "config", "--get", "core.hooksPath");
  if (hooksPath) {
    const abs = path.resolve(repo, hooksPath);
    // husky 9 sets core.hooksPath to .husky/_, whose files it makes and
    // remakes; a person's own hook is .husky/pre-commit.
    if (path.basename(abs) === "_" && path.basename(path.dirname(abs)) === ".husky")
      return { file: path.join(path.dirname(abs), "pre-commit"), kind: "husky" };
    if (path.basename(abs) === ".husky")
      return { file: path.join(abs, "pre-commit"), kind: "husky" };
    return { file: path.join(abs, "pre-commit"), kind: "hooks-path" };
  }
  const hooks = git(repo, "rev-parse", "--git-path", "hooks") ?? ".git/hooks";
  return { file: path.join(path.resolve(repo, hooks), "pre-commit"), kind: "git" };
}

/** The hook's text with Anur's lines in it, once, first, replacing an older copy of them. */
export function withHookLines(current: string | null): string {
  if (current === null) return `#!/bin/sh\n${HOOK_LINES}\n`;
  const begin = current.indexOf(HOOK_BEGIN);
  const end = begin >= 0 ? current.indexOf(HOOK_END, begin) : -1;
  if (begin >= 0 && end >= 0)
    return current.slice(0, begin) + HOOK_LINES + current.slice(end + HOOK_END.length);
  // First, right after the shebang: a hook that ends by exec'ing another
  // program, as pre-commit's and lefthook's do, never reaches lines after it.
  // Anur's step only adds the block and never fails, so it's safe to run first.
  const shebang = /^#![^\n]*\n/.exec(current);
  const head = shebang ? shebang[0] : "";
  const rest = current.slice(head.length);
  return `${head}${HOOK_LINES}\n\n${rest}`;
}

/** Put Anur's lines in the repo's pre-commit hook; whether anything changed. */
export function installPreCommit(repo: string): { file: string; changed: boolean } {
  const { file } = hookFileFor(repo);
  let now: string | null;
  try {
    now = readFileSync(file, "utf8");
  } catch {
    now = null;
  }
  const next = withHookLines(now);
  if (next === now) return { file, changed: false };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, next);
  // A new hook is made runnable; an existing one keeps its mode, so a
  // committed husky file doesn't pick up a mode change in the commit.
  if (now === null) chmodSync(file, 0o755);
  return { file, changed: true };
}

/** Whether the repo's pre-commit hook carries Anur's lines (for 23.8's "hook not active"). */
export function preCommitInstalled(repo: string): boolean {
  const { file } = hookFileFor(repo);
  return existsSync(file) && readFileSync(file, "utf8").includes(HOOK_BEGIN);
}

/**
 * Why a repo's hook isn't rebuilding its `CLAUDE.md` block (23.8), or null
 * when it is, or when the repo keeps no decisions and needs none. `fix` says
 * whether putting Anur's lines back in mends it.
 */
export type HookTrouble = { why: string; fix: boolean };

export function hookTrouble(
  repo: string,
  shim: string = path.join(process.env.HOME ?? "", ".anur", "bin", "anur-pre-commit"),
): HookTrouble | null {
  const decisions = path.join(repo, ".anur", "decisions");
  let kept: boolean;
  try {
    kept = readdirSync(decisions).some((n) => n.endsWith(".jsonl"));
  } catch {
    kept = false;
  }
  if (!kept) return null;
  const { file, kind } = hookFileFor(repo);
  if (!preCommitInstalled(repo)) return { why: "its pre-commit hook doesn't call Anur", fix: true };
  // husky runs its hooks with sh; a plain git hook must be executable to run.
  if (kind !== "husky" && !executable(file))
    return { why: "its pre-commit hook isn't executable, so git skips it", fix: true };
  if (!executable(shim))
    return { why: "Anur's pre-commit script is missing on this Mac; reopen Anur", fix: false };
  if (blockBehind(repo))
    return {
      why: "the last commit's CLAUDE.md doesn't list its decisions: it was made without the hook (--no-verify, or a tool that skips hooks). The next commit puts them back",
      fix: false,
    };
  return null;
}

function executable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Whether `CLAUDE.md` at HEAD lacks the block its committed decisions make. */
function blockBehind(repo: string): boolean {
  if (git(repo, "rev-parse", "--verify", "--quiet", "HEAD") === null) return false;
  const entries = entriesAt(repo, "HEAD");
  if (!entries.length) return false;
  const now = git(repo, "show", "HEAD:CLAUDE.md");
  const text = now === null ? null : `${now}\n`;
  // As of the commit's own day: a decision whose "until" passed since isn't the hook's fault.
  const when = git(repo, "log", "-1", "--format=%cI", "HEAD");
  const at = when ? new Date(when) : new Date();
  const want = withBlock(
    text,
    renderBlock(entries, "team", Number.isNaN(at.getTime()) ? new Date() : at),
  );
  // git trims nothing but the final newline here; compare without it.
  return (want ?? "").trimEnd() !== (text ?? "").trimEnd();
}
