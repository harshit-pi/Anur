import path from "node:path";

/**
 * What the agent picked up with its own tools, as Anur keeps it (4.3;
 * Context, "Inputs"). A finished tool call is an input when it brought
 * something in from outside the thread's bundle: a file it read, another
 * doc in the folder (kept as a pointer, read fresh), a command's output, a
 * fetch's answer, a search's results, or another MCP server's result.
 * Anur's own tools, edits, and reads of the thread's own doc or working
 * copy are not inputs: the doc reaches a thread only through its bundle.
 */

export type Captured = {
  source: "file" | "doc" | "command" | "fetch" | "search" | "mcp";
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
}): Captured | null {
  const name = call.name ?? "";
  const input = (call.input ?? {}) as Record<string, unknown>;
  const text = outputText(call.output);
  if (name === "Read" && typeof input.file_path === "string") {
    const file = path.resolve(call.folder, input.file_path);
    if (inside(call.copies, file) || file === call.copies) return null;
    if (inside(call.folder, file)) {
      const rel = path.relative(call.folder, file).split(path.sep).join("/");
      if (rel.split("/").some((p) => p.startsWith("."))) return null;
      if (/\.md$/i.test(rel))
        return rel === call.doc
          ? null
          : { source: "doc", label: rel, ref: rel, text: null, trust: "trusted" };
      return { source: "file", label: rel, ref: rel, text, trust: "trusted" };
    }
    return { source: "file", label: file, ref: file, text, trust: "trusted" };
  }
  if (name === "Bash" && typeof input.command === "string") {
    if (!text.trim()) return null;
    const command = input.command.trim();
    return {
      source: "command",
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
      label: `${server}: ${tool}`,
      ref: name,
      text: `${server}: ${tool}\nCalled with: ${JSON.stringify(call.input)}\n\n${text}`,
      trust: "trusted",
    };
  }
  return null;
}
