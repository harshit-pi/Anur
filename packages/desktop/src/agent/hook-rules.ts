import path from "node:path";
import { denies, type DenyRule } from "./deny-rules.ts";

/**
 * What Anur's hook allows a thread's agent to do (Context, "The person's
 * agent, at full power"). The agent keeps everything it normally has; the
 * hook blocks only where other threads live, and sends every read and edit
 * of a doc to this thread's working copy of it, whose difference from the
 * doc becomes the preview (3.6).
 *
 * Pure, so it is tested without an agent; `hook.ts` runs it for Claude Code.
 */

export type HookConfig = {
  /** The opened folder, as a real path. */
  folder: string;
  /** Its `.anur/`. */
  anurDir: string;
  /**
   * Every home's `.anur/` beneath the folder, its own included (18.15.2):
   * threads live in each doc's home, and none is the agent's to touch.
   */
  anurDirs?: string[];
  thread: string;
  /** Where every call is logged, for the call-matching check (3.2). */
  log: string;
  /** This thread's working copies: each doc at its own path inside. */
  copies: string;
  /** Every thread's working copies; the others' are off limits. */
  copiesRoot: string;
  /** The person's own deny rules for docs, held to apply to their working copies too (3.3). */
  denies?: DenyRule[];
};

/** Every `.anur/` the agent must leave alone. */
const anurDirsOf = (config: HookConfig) => [config.anurDir, ...(config.anurDirs ?? [])];
const inAnur = (abs: string, config: HookConfig) => anurDirsOf(config).some((d) => inside(abs, d));

/** A refusal, and the working copy to make first when it sends the agent to one. */
export type Decision = { reason: string; copy: { from: string; to: string } | null };

export type ToolCall = {
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd?: string;
};

/** Resolve a path the way the design asks: absolute, symlinks followed where they exist. */
export type Resolver = (p: string, cwd: string) => string;

const lower = (p: string) => p.toLowerCase();
/** Inside `dir`, ignoring letter case, as macOS's default file system does. */
export const inside = (p: string, dir: string) =>
  lower(p) === lower(dir) || lower(p).startsWith(lower(dir) + path.sep);

const INSTRUCTION_FILES = new Set(["claude.md", "claude.local.md", "agents.md", "gemini.md"]);

/** A doc: a Markdown file in the folder, outside dot-folders, other than agent instruction files. */
export function isDoc(abs: string, folder: string): boolean {
  if (!inside(abs, folder) || !lower(abs).endsWith(".md")) return false;
  const rel = path.relative(folder, abs);
  if (rel.split(path.sep).some((part) => part.startsWith("."))) return false;
  return !INSTRUCTION_FILES.has(lower(path.basename(abs)));
}

/** Tools that only read a file; every other file tool edits. */
const READ_TOOLS = new Set(["Read", "NotebookRead"]);

export const MESSAGES = {
  anur: "Anur: .anur/ holds every other thread and is off limits to this one.",
  recursive:
    "Anur: a recursive read from here would read .anur/, where other threads live. Use rg, which skips it, or add --exclude-dir=.anur.",
  gitClean:
    "Anur: git clean -x would delete .anur/, where every thread lives. Add -e .anur to keep it.",
  otherCopy: "Anur: that is another thread's working copy, and off limits to this one.",
  ownRule: (rule: string, rel: string) =>
    `Your own settings deny this (${rule}), and that holds for the working copy of ${rel} too.`,
} as const;

/** The message that sends the agent to a doc's working copy. */
export const toCopy = (rel: string, copy: string) =>
  `Anur: in a thread, docs are read and edited in your working copy, never in the folder, so the person can review your edits before they land. Your working copy of ${rel} is at ${copy}. Use that path instead, with the same tool. A new doc written there is added to the folder when your turn ends, so name it by its place in the folder.`;

const refuse = (reason: string): Decision => ({ reason, copy: null });

/** Why the call is refused, or null to let it run. */
export function decide(call: ToolCall, config: HookConfig, resolve: Resolver): Decision | null {
  const cwd = call.cwd ?? config.folder;
  const input = call.tool_input;
  const filePath = input.file_path ?? input.notebook_path;

  // The agent's own file tools.
  if (typeof filePath === "string") {
    const abs = resolve(filePath, cwd);
    if (inAnur(abs, config)) return refuse(MESSAGES.anur);
    if (inside(abs, config.copiesRoot) && !inside(abs, config.copies))
      return refuse(MESSAGES.otherCopy);
    // A working copy is held to the person's own rules for the doc it copies.
    if (inside(abs, config.copies) && abs !== config.copies) {
      const rel = path.relative(config.copies, abs);
      const kind = READ_TOOLS.has(call.tool_name) ? "read" : "edit";
      const rule = denies(config.denies ?? [], kind, path.join(config.folder, rel));
      if (rule) return refuse(MESSAGES.ownRule(rule.rule, rel));
    }
    if (isDoc(abs, config.folder)) {
      const rel = path.relative(config.folder, abs);
      const copy = path.join(config.copies, rel);
      return { reason: toCopy(rel, copy), copy: { from: abs, to: copy } };
    }
    return null;
  }

  // Shell commands, where every search runs: Claude Code has no Grep or Glob tool.
  if (call.tool_name === "Bash" && typeof input.command === "string") {
    const reason = decideShell(input.command, config, (p) => resolve(p, cwd));
    return reason ? refuse(reason) : null;
  }

  // Any other tool, MCP tools included: a string argument pointing into .anur/.
  for (const value of strings(input)) {
    if (value.includes(".anur") && inAnur(resolve(value, cwd), config))
      return refuse(MESSAGES.anur);
  }
  return null;
}

function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

const EXCLUDES_ANUR =
  /--exclude-dir[= ]['"]?\.?\/?\.anur|(?:\s-e|--exclude[= ])\s*['"]?\.?\/?\.anur|:!\.anur/;

export function decideShell(
  cmd: string,
  config: HookConfig,
  resolve: (p: string) => string,
): string | null {
  const excludesAnur = EXCLUDES_ANUR.test(cmd);
  if (/\bgit\s+clean\b/.test(cmd) && /\s-[a-zA-Z]*[xX]/.test(cmd) && !excludesAnur)
    return MESSAGES.gitClean;

  // A path into .anur/, named outright; listing its size or entries reads no thread.
  const words = cmd.split(/[\s;|&<>()'"`]+/).filter(Boolean);
  const namesAnur = words.some((w) => w.includes(".anur") && inAnur(resolve(w), config));
  if (namesAnur && !excludesAnur && !/^\s*(du|ls|stat)\b/.test(cmd)) return MESSAGES.anur;

  // A recursive read whose root holds .anur/; rg and git grep honour its ignore files.
  const recursiveGrep = /\b[ef]?grep\b[^|;&]*\s-[a-zA-Z]*[rR]/.test(cmd);
  const rgNoIgnore = /\brg\b[^|;&]*(\s-u+\b|--no-ignore|--hidden\s+-u)/.test(cmd);
  const findReads =
    /\bfind\b[^|;&]*(\|\s*xargs\s+\S+|-exec\s+(cat|grep|head|tail|less|sed|awk))/.test(cmd);
  if ((recursiveGrep || rgNoIgnore || findReads) && !excludesAnur) {
    const roots = words.filter((w) => !w.startsWith("-") && (w === "." || w.includes("/")));
    const fromHere = roots.length === 0 ? [resolve(".")] : roots.map(resolve);
    if (fromHere.some((r) => anurDirsOf(config).some((d) => inside(d, r))))
      return MESSAGES.recursive;
  }

  // Writes onto a doc from the shell are not refused: an agent can make them
  // in Obsidian, and Anur turns them into the thread's proposal afterwards.
  return null;
}
