import path from "node:path";

/**
 * What the agent picked up with its own tools, as Anur keeps it (4.3;
 * Context, "Inputs"). A finished tool call is an input when it brought
 * something in from outside the thread's bundle: a file it read, another
 * doc in the folder (kept as a pointer, read fresh), a command's output, a
 * fetch's answer, a search's results, or another MCP server's result.
 * Anur's own tools, edits, and reads of the thread's own doc or working
 * copy are not inputs: the doc reaches a thread only through its bundle.
 * Nor is the agent's own work: commands that write, run or build, and
 * reads of files the thread itself wrote.
 */

export type Captured = {
  source: "file" | "doc" | "command" | "fetch" | "search" | "mcp";
  /**
   * Kept on this device only: what was read from the person's machine
   * outside the folder (a file, a command's output, another MCP server's
   * answer). `.anur/` is shared, often through git; this never enters it.
   */
  local: boolean;
  label: string;
  ref: string;
  /** The content to snapshot; null for a doc, which is a pointer. */
  text: string | null;
  trust: "trusted" | "untrusted";
};

/** A tool's output as text: a string, or the text parts of a content list. */
export function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const parts = output.flatMap((p) => {
      const o = p as { type?: unknown; text?: unknown; content?: { text?: unknown } };
      if (typeof o.text === "string") return [o.text];
      if (typeof o.content?.text === "string") return [o.content.text];
      return [];
    });
    if (parts.length > 0) return parts.join("\n");
  }
  return output == null ? "" : JSON.stringify(output, null, 1);
}

/** Programs that only read: a command made of these (and cd) brings something in. */
const READERS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "ls",
  "tree",
  "stat",
  "file",
  "du",
  "wc",
  "pwd",
  "rg",
  "grep",
  "egrep",
  "fgrep",
  "ag",
  "find",
  "fd",
  "mdfind",
  "which",
  "type",
  "jq",
  "yq",
  "awk",
  "cut",
  "sort",
  "uniq",
  "tr",
  "column",
  "nl",
  "diff",
  "cmp",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "date",
  "echo",
  "printf",
  "true",
  "cd",
  "sed",
  "git",
  "curl",
  "gh",
]);
/** git and gh subcommands that only read. */
const GIT_READS = new Set([
  "log",
  "show",
  "diff",
  "status",
  "blame",
  "ls-files",
  "rev-parse",
  "branch",
  "remote",
  "describe",
  "shortlog",
  "grep",
  "config",
]);
const GH_READS = new Set(["view", "list", "diff", "status", "checks", "api"]);

/**
 * Whether a shell command only reads, so its output is something brought
 * in: every step is a reading program, nothing is written to a file, and no
 * script runs. Running, building, testing and writing are the agent's own
 * work, not inputs.
 */
export function readsOnly(command: string): boolean {
  // Quoted text is an argument, never a pipe, a redirect or a step.
  const bare = command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "Q");
  if (/<<|\$\(|`/.test(bare)) return false;
  // Any redirect into a file, other than throwing output away or merging streams.
  const redirects = bare.match(/\d*>>?\s*&?\S*/g) ?? [];
  if (redirects.some((r) => !/^\d*>\s*(?:\/dev\/null|&\d)$/.test(r.replace(/>>/, ">"))))
    return false;
  const steps = bare
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (steps.length === 0) return false;
  return steps.every((step) => {
    const words = step.split(/\s+/).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    const [cmd = "", sub = ""] = words;
    const name = cmd.split("/").at(-1) ?? "";
    if (!READERS.has(name)) return false;
    if (name === "git") return GIT_READS.has(sub);
    if (name === "gh") return GH_READS.has(words[2] ?? sub) && !words.includes("-X");
    if (name === "sed") return words.includes("-n") && !words.some((w) => w.startsWith("-i"));
    if (name === "find")
      return !words.some((w) => ["-delete", "-exec", "-execdir", "-ok"].includes(w));
    if (name === "curl")
      return !words.some((w) =>
        /^(-X|--request|-d|--data.*|-F|--form|-T|--upload-file|-o|--output|-O)$/.test(w),
      );
    return true;
  });
}

const inside = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

export function classify(call: {
  name: string | null;
  input: unknown;
  output: unknown;
  /** The opened folder. */
  folder: string;
  /** Where this thread's working copies live. */
  copies: string;
  /** The thread's own doc, relative to the folder. */
  doc: string;
  /** Files this thread wrote: reading its own work back brings nothing in. */
  made?: ReadonlySet<string>;
}): Captured | null {
  const name = call.name ?? "";
  const input = (call.input ?? {}) as Record<string, unknown>;
  const text = outputText(call.output);
  if (name === "Read" && typeof input.file_path === "string") {
    const file = path.resolve(call.folder, input.file_path);
    if (inside(call.copies, file) || file === call.copies) return null;
    if (call.made?.has(file)) return null;
    if (inside(call.folder, file)) {
      const rel = path.relative(call.folder, file).split(path.sep).join("/");
      if (rel.split("/").some((p) => p.startsWith("."))) return null;
      if (/\.md$/i.test(rel))
        return rel === call.doc
          ? null
          : { source: "doc", local: false, label: rel, ref: rel, text: null, trust: "trusted" };
      return { source: "file", local: false, label: rel, ref: rel, text, trust: "trusted" };
    }
    return { source: "file", local: true, label: file, ref: file, text, trust: "trusted" };
  }
  if (name === "Bash" && typeof input.command === "string") {
    if (!text.trim()) return null;
    const command = input.command.trim();
    if (!readsOnly(command)) return null;
    return {
      source: "command",
      local: true,
      label: `$ ${command.length > 80 ? `${command.slice(0, 80)}…` : command}`,
      ref: command,
      text,
      trust: "trusted",
    };
  }
  if (name === "WebFetch" && typeof input.url === "string") {
    const prompt = typeof input.prompt === "string" ? input.prompt : "";
    return {
      source: "fetch",
      local: false,
      label: input.url,
      ref: input.url,
      // Claude Code's fetch returns a model's answer about the page, not the page.
      text: `Fetched: ${input.url}\nQuestion: ${prompt}\n\nAnswer (from the fetch, not the page itself):\n${text}`,
      trust: "untrusted",
    };
  }
  if (name === "WebSearch" && typeof input.query === "string")
    return {
      source: "search",
      local: false,
      label: `search: ${input.query}`,
      ref: input.query,
      text,
      trust: "untrusted",
    };
  if (name.startsWith("mcp__") && !name.startsWith("mcp__anur__")) {
    const [, server = "", tool = ""] = name.split("__");
    if (!text.trim()) return null;
    return {
      source: "mcp",
      local: true,
      label: `${server}: ${tool}`,
      ref: name,
      text: `${server}: ${tool}\nCalled with: ${JSON.stringify(call.input)}\n\n${text}`,
      trust: "trusted",
    };
  }
  return null;
}
