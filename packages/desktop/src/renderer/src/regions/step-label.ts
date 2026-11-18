/** How a thread's steps read to a person (Think): what each did, never the raw command. */

const unquote = (p: string) => p.replace(/^["']|["']$/g, "");
const base = (p: string) => unquote(p).split("/").filter(Boolean).pop() ?? p;
const AGENT_TOOL =
  /^(Read|Write|Edit|MultiEdit|Glob|Grep|WebFetch|WebSearch|Task|TodoWrite|NotebookEdit)\b/;

/**
 * A step as a person would say it: "Read competitors.txt", "Searched the
 * folder", never the raw command with the folder's full path. `read` lists
 * the files it read, for a run's one-line summary.
 */
export function stepOf(title: string): { label: string; read: string[] } {
  const tool = AGENT_TOOL.exec(title)?.[1];
  if (tool) {
    const rest = title.slice(tool.length).trim();
    const copy = /^working copy of (.+)$/.exec(rest)?.[1];
    if (tool === "Read") return { label: `Read ${base(rest)}`, read: [base(rest)] };
    if (copy) return { label: `${tool === "Write" ? "Wrote" : "Edited"} ${base(copy)}`, read: [] };
    if (tool === "Write") return { label: `Wrote ${base(rest)}`, read: [] };
    if (tool === "Edit" || tool === "MultiEdit") return { label: `Edited ${base(rest)}`, read: [] };
    if (tool === "Glob" || tool === "Grep") return { label: "Searched the folder", read: [] };
    if (tool === "WebFetch") return { label: "Read a web page", read: [] };
    if (tool === "WebSearch") return { label: "Searched the web", read: [] };
    return { label: title.replace(/\/\S*\//g, ""), read: [] };
  }
  // A shell command: what it did, without the cd into the folder.
  const cmd = title.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, "").trim();
  const read = [
    ...cmd.matchAll(
      /(?:^|[;&|]\s*|\s)(?:cat|head|tail|less|wc)\s+(?:-\S+\s+)*("[^"]+"|'[^']+'|[^\s;|&>]+)/g,
    ),
  ]
    .map((m) => base(m[1] ?? ""))
    .filter((f) => f && !f.startsWith("-") && f !== "*");
  if (read.length) return { label: `Read ${listOf(read)}`, read };
  if (/^(rg|grep|ag)\b/.test(cmd)) return { label: "Searched the folder", read: [] };
  if (/^(ls|find|tree|for)\b/.test(cmd)) return { label: "Looked through the folder", read: [] };
  const word = /^[\w.-]+/.exec(cmd)?.[0];
  return { label: word ? `Ran ${word}` : "Ran a command", read: [] };
}

export function listOf(names: string[], max = 2): string {
  const u = [...new Set(names)];
  if (u.length <= max) return u.join(" and ");
  return `${u.slice(0, max).join(", ")} and ${String(u.length - max)} more`;
}
