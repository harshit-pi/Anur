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

/** Anur's own tools, named for the person rather than by their ids: done, and while running. */
export const TOOL_NAMES: Record<string, { done: string; doing: string }> = {
  anur_name_thread: { done: "Named the thread", doing: "Naming the thread" },
  anur_list_inputs: {
    done: "Looked at the section's inputs",
    doing: "Looking at the section's inputs",
  },
  anur_read_input: { done: "Read an input", doing: "Reading an input" },
  anur_report_check: { done: "Reported the check", doing: "Reporting the check" },
  anur_offer_options: { done: "Offered options", doing: "Offering options" },
  anur_propose_action: { done: "Proposed an action", doing: "Proposing an action" },
  anur_propose_preview: { done: "Proposed an edit", doing: "Proposing an edit" },
  anur_note_decision: { done: "Noted a decision", doing: "Noting a decision" },
  anur_drop_decision: { done: "Took back a decision", doing: "Taking back a decision" },
  anur_propose_finding: { done: "Proposed a finding", doing: "Proposing a finding" },
  anur_search_sections: { done: "Searched the doc", doing: "Searching the doc" },
  anur_read_section: { done: "Read a section", doing: "Reading a section" },
  anur_section_bundle: {
    done: "Read what a thread starts with",
    doing: "Reading what a thread starts with",
  },
  anur_outline: { done: "Read the doc's headings", doing: "Reading the doc's headings" },
  anur_links: { done: "Looked up the section's links", doing: "Looking up the section's links" },
  anur_list_threads: { done: "Looked at the doc's threads", doing: "Looking at the doc's threads" },
  anur_create_doc: { done: "Made a doc", doing: "Making a doc" },
  anur_open: { done: "Opened a doc", doing: "Opening a doc" },
  anur_remove_doc: { done: "Removed a page", doing: "Removing a page" },
  anur_plugin_action: { done: "Ran a plugin action", doing: "Running a plugin action" },
};

/** An Anur tool's name, done or running; null for any other tool. */
export function ownToolName(title: string, when: "done" | "doing"): string | null {
  const own = /^mcp__anur__(\w+)/.exec(title)?.[1];
  if (!own) return null;
  return TOOL_NAMES[own]?.[when] ?? own.replace(/^anur_/, "").replace(/_/g, " ");
}

/** What a running step says: an Anur tool by what it does, anything else as it came. */
export function doingOf(title: string): string {
  return ownToolName(title, "doing") ?? title;
}
