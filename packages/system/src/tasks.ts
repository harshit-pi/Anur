/**
 * Task boundaries and the change report (group 21; Design - Engineering
 * Plugin §1–2). At each prompt every repo in the folder is recorded: its
 * HEAD and its dirty files, kept as blobs. At Stop each repo is compared with
 * that record, so only what changed during the task counts, in any repo,
 * committed or not. Each changed file gets a category by rule, and the
 * report ranks them: data, auth, calls, UI, other.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findRepoDirs } from "./repos.ts";
import type { Part } from "./parts.ts";

export type Category = "data" | "auth" | "calls" | "ui" | "other";
export const CATEGORY_ORDER: readonly Category[] = ["data", "auth", "calls", "ui", "other"];

export type RepoMark = {
  dir: string;
  head: string | null;
  /** Dirty files at the mark, relative to the repo, with the blob each held; "-" when deleted. */
  dirty: Record<string, string>;
};
export type TaskMark = { at: string; session: string; prompt: string; repos: RepoMark[] };

export type ReportLine = {
  category: Category;
  repo: string;
  /** The part the file belongs to, when one clearly does. */
  part: string | null;
  /** Relative to the opened folder. */
  file: string;
  /** The first changed line, 1-based; null for a deleted file. */
  line: number | null;
  /** What that line now says, trimmed. */
  text: string;
  how: "added" | "changed" | "deleted";
};

export type TaskReport = {
  id: string;
  session: string;
  prompt: string;
  startedAt: string;
  endedAt: string;
  repos: { dir: string; from: string | null; to: string | null }[];
  lines: ReportLine[];
  /** Claude's own choices, from its report at task end (filled by the caller). */
  choices: string[];
};

const git = (cwd: string, args: string[], input?: string): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
  });

function headOf(repo: string): string | null {
  try {
    return git(repo, ["rev-parse", "HEAD"]).trim();
  } catch {
    return null; // No commits yet.
  }
}

/** Dirty paths, relative to the repo, untracked files included. */
function dirtyPaths(repo: string): { path: string; deleted: boolean }[] {
  const out = git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const items = out.split("\0").filter(Boolean);
  const res: { path: string; deleted: boolean }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] ?? "";
    const code = it.slice(0, 2);
    const p = it.slice(3);
    if (code.startsWith("R") || code.startsWith("C")) i++; // The old name follows.
    res.push({ path: p, deleted: code.includes("D") });
  }
  return res;
}

/** Writes files' current contents as blobs; their hashes, in order. */
function blobs(repo: string, files: string[]): string[] {
  if (!files.length) return [];
  return git(repo, ["hash-object", "-w", "--stdin-paths"], files.join("\n") + "\n")
    .trim()
    .split("\n");
}

function markRepo(folder: string, dir: string): RepoMark {
  const repo = path.join(folder, dir);
  const dirty = dirtyPaths(repo);
  const live = dirty.filter((d) => !d.deleted).map((d) => d.path);
  const hashes = blobs(repo, live);
  const map: Record<string, string> = {};
  live.forEach((p, i) => (map[p] = hashes[i] ?? ""));
  for (const d of dirty) if (d.deleted) map[d.path] = "-";
  return { dir, head: headOf(repo), dirty: map };
}

/** Records every repo in the folder at a prompt. */
export function markTask(folder: string, session: string, prompt: string): TaskMark {
  return {
    at: new Date().toISOString(),
    session,
    prompt: prompt.slice(0, 300),
    repos: findRepoDirs(folder).map((dir) => markRepo(folder, dir)),
  };
}

/** The first changed line of a diff between two blobs (or nothing), and its text. */
function firstChange(
  repo: string,
  from: string | null,
  to: string,
): { line: number; text: string } {
  const empty = git(repo, ["hash-object", "-w", "--stdin"], "").trim();
  const diff = git(repo, ["diff", "-U0", "--no-color", "--no-ext-diff", from ?? empty, to]);
  const lines = diff.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(lines[i] ?? "");
    if (!m) continue;
    const start = Number(m[1]);
    const added = lines.slice(i + 1).find((l) => l.startsWith("+") && !l.startsWith("+++"));
    if (m[2] === "0") return { line: Math.max(1, start), text: "" }; // Only removals here.
    return { line: start, text: (added ?? "+").slice(1).trim() };
  }
  return { line: 1, text: "" };
}

/** Added lines between two blobs, for categories that read the code. */
function addedText(repo: string, from: string | null, to: string): string {
  const empty = git(repo, ["hash-object", "-w", "--stdin"], "").trim();
  return git(repo, ["diff", "-U0", "--no-color", "--no-ext-diff", from ?? empty, to])
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
}

/**
 * A file's category by rule (21.3a). A file matching several takes the
 * first of data, auth, calls, UI; anything else is "other", ranked last.
 */
export function categoryOf(file: string, added: string): Category {
  const p = file.toLowerCase();
  if (
    /(^|\/)(migrations?|schemas?|models?|prisma|db|database)\//.test(p) ||
    /\.(sql|prisma)$/.test(p) ||
    /(^|\/)schema\.[a-z]+$/.test(p) ||
    /\b(create|alter|drop)\s+table\b|new\s+(dynamodb\.)?(table|tablev2)\s*\(|\b(add|drop|rename)column\b|\bcolumn\s*\(|db\.Model\b|models\.Model\b|\bDataTypes\./i.test(
      added,
    )
  )
    return "data";
  if (
    /(^|[/_.-])(auth|session|sessions|token|tokens|login|oauth|jwt|passport|permissions?)([/_.-]|$)/.test(
      p,
    ) ||
    /^\s*(import|from|const .*require\().*\b(auth|session|token|jwt|oauth|passport)\b/im.test(added)
  )
    return "auth";
  if (
    /\bfetch\s*\(|\baxios(\.[a-z]+)?\s*\(|\bgot(\.[a-z]+)?\s*\(|\bky(\.[a-z]+)?\s*\(|\brequests\.(get|post|put|patch|delete)\s*\(|\bhttpx\.|\bhttps?\.request\s*\(|\burllib\.request\b|\bHttpClient\b|\bWebClient\b|\bRestTemplate\b/.test(
      added,
    )
  )
    return "calls";
  if (/\.(tsx|jsx|css|scss|sass|less|vue|svelte|html)$/.test(p)) return "ui";
  return "other";
}

/** The part a file belongs to: the nearest build file's folder in its repo, when one part claims it. */
export function partOf(parts: readonly Part[], repo: string, file: string): string | null {
  const mine = parts.filter((x) => x.repo === repo);
  let best: Part[] = [];
  let depth = -1;
  for (const x of mine) {
    const dir = path.posix.dirname(x.file);
    const prefix = dir === "." ? "" : dir + "/";
    if (!file.startsWith(prefix)) continue;
    const d = prefix.split("/").length;
    if (d > depth) {
      depth = d;
      best = [x];
    } else if (d === depth) best.push(x);
  }
  if (best.length === 1) return best[0]?.name ?? null;
  // A package and its CDK stacks share a folder: the package names the code.
  return best.find((x) => x.kind === "package")?.name ?? null;
}

const rank = (c: Category) => CATEGORY_ORDER.indexOf(c);

/**
 * What changed in each repo since the mark, ranked. Files dirty at the mark
 * and unchanged since are not the task's; a repo added since is all new.
 */
export function reportSince(
  folder: string,
  mark: TaskMark,
  parts: readonly Part[],
): TaskReport | null {
  const lines: ReportLine[] = [];
  const repos: TaskReport["repos"] = [];
  for (const dir of findRepoDirs(folder)) {
    const repo = path.join(folder, dir);
    const before = mark.repos.find((r) => r.dir === dir) ?? { dir, head: null, dirty: {} };
    const now = markRepo(folder, dir);
    const changed = new Set<string>();
    if (before.head && now.head && before.head !== now.head)
      for (const f of git(repo, ["diff", "--name-only", "-z", before.head, now.head]).split("\0"))
        if (f) changed.add(f);
    for (const f of Object.keys(now.dirty)) changed.add(f);
    for (const f of Object.keys(before.dirty)) changed.add(f); // Reverted to clean counts too.
    const rows: ReportLine[] = [];
    for (const f of [...changed].sort()) {
      const wasBlob = before.dirty[f] ?? (before.head ? blobAt(repo, before.head, f) : null);
      const nowBlob = now.dirty[f] ?? (now.head ? blobAt(repo, now.head, f) : null);
      if ((wasBlob ?? "-") === (nowBlob ?? "-")) continue; // Untouched during the task.
      const rel = path.posix.join(dir, f);
      const part = partOf(parts, dir, rel);
      if (!nowBlob || nowBlob === "-") {
        rows.push({
          category: categoryOf(rel, ""),
          repo: dir,
          part,
          file: rel,
          line: null,
          text: "",
          how: "deleted",
        });
        continue;
      }
      const from = wasBlob && wasBlob !== "-" ? wasBlob : null;
      const first = firstChange(repo, from, nowBlob);
      rows.push({
        category: categoryOf(rel, addedText(repo, from, nowBlob)),
        repo: dir,
        part,
        file: rel,
        line: first.line,
        text: first.text.slice(0, 160),
        how: from ? "changed" : "added",
      });
    }
    if (rows.length) {
      lines.push(...rows);
      repos.push({ dir, from: before.head, to: now.head });
    }
  }
  if (!lines.length) return null; // A Stop that changed nothing writes no report.
  lines.sort(
    (a, b) =>
      rank(a.category) - rank(b.category) ||
      a.repo.localeCompare(b.repo) ||
      a.file.localeCompare(b.file),
  );
  const endedAt = new Date().toISOString();
  return {
    id: `${endedAt.replace(/[:.]/g, "-")}-${mark.session.slice(0, 8) || "task"}`,
    session: mark.session,
    prompt: mark.prompt,
    startedAt: mark.at,
    endedAt,
    repos,
    lines,
    choices: [],
  };
}

function blobAt(repo: string, commit: string, file: string): string | null {
  try {
    return git(repo, ["rev-parse", `${commit}:${file}`]).trim();
  } catch {
    return null;
  }
}

/** Where a folder keeps its tasks: marks waiting for Stop, and reports. */
export const tasksDir = (folder: string) => path.join(folder, ".anur", "tasks");
const markFile = (folder: string, session: string) =>
  path.join(tasksDir(folder), "marks", `${session.replace(/[^\w-]/g, "_") || "session"}.json`);

export function saveMark(folder: string, mark: TaskMark): void {
  const f = markFile(folder, mark.session);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(mark));
}

export function readMark(folder: string, session: string): TaskMark | null {
  try {
    return JSON.parse(readFileSync(markFile(folder, session), "utf8")) as TaskMark;
  } catch {
    return null;
  }
}

export function saveReport(folder: string, report: TaskReport): string {
  const f = path.join(tasksDir(folder), `${report.id}.json`);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(report, null, 2));
  return f;
}

/**
 * The opened folder a working directory belongs to: the outermost folder
 * holding `.anur/` below the home folder, so a repo inside an opened folder
 * of repos reports to that folder, not to its own `.anur/`.
 */
export function folderFor(cwd: string, home = os.homedir()): string | null {
  let found: string | null = null;
  for (
    let d = path.resolve(cwd);
    d !== path.resolve(home) && path.dirname(d) !== d;
    d = path.dirname(d)
  )
    if (existsSync(path.join(d, ".anur"))) found = d;
  return found;
}
