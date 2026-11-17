import { z } from "zod";
import { SnapshotHash, ThreadId } from "../ids.ts";
import { LineEnvelope } from "../jsonl/lines.ts";
import { SectionId } from "../sections/section.ts";

/**
 * `docs/<doc>/inputs/<device>.jsonl` (task 1.9): one line per input a thread
 * used or a person added, and one per removal, so a removed input never
 * comes back (Context, "Inputs").
 */
export const InputSource = z.enum([
  "file", //        a file the agent read, other than a doc in the folder
  "doc", //         another doc in the folder, kept as a pointer to its decided text
  "mcp", //         a result from another MCP server
  "shell", //       a shell command's output
  "shell-file", //  a file read through a shell command; the capture may be incomplete
  "fetch", //       the agent's fetch: the URL, the question and the model's answer
  "chat", //        an input from the source chat, on the title
  "section", //     a section read beyond the rules, kept only when pinned
  "attachment", //  a file the person added, copied into the folder's attachments
  "mock", //        an image or HTML file the person added
  "link", //        a link the person pasted, fetched when a thread uses it
  "sidebar-file", // a file the person dragged from the sidebar
]);
export type InputSource = z.infer<typeof InputSource>;

/**
 * Trust comes from the kind of source (Security, "What counts as trusted"):
 * the person's own docs and choices, the agent's own reads, or a fetched page,
 * which is always data and never instructions.
 */
export const Trust = z.enum(["person", "agent", "untrusted"]);
export type Trust = z.infer<typeof Trust>;

export function trustOf(source: InputSource): Trust {
  switch (source) {
    case "doc":
    case "chat":
    case "section":
    case "attachment":
    case "mock":
    case "sidebar-file":
      return "person";
    case "fetch":
    case "link":
      return "untrusted";
    case "file":
    case "mcp":
    case "shell":
    case "shell-file":
      return "agent";
  }
}

export const InputLine = LineEnvelope.extend({
  kind: z.literal("input"),
  /** Stable across devices, so a removal can name it. */
  input: z.string().min(1).max(64),
  /** The section it was used or added on; it carries to new threads there and below. */
  section: SectionId,
  /** The thread that used it; null when a person added it to the section. */
  thread: ThreadId.nullable(),
  source: InputSource,
  trust: Trust,
  /** Where it came from: a path in or out of the folder, a URL, a server and tool, or a command. */
  ref: z.object({
    path: z.string().nullable(),
    url: z.string().nullable(),
    server: z.string().nullable(),
    tool: z.string().nullable(),
    command: z.string().nullable(),
    /** For a fetch: the question the agent asked about the page. */
    question: z.string().nullable(),
  }),
  /** The content's hash when used; null for a pointer to a doc, which is read fresh. */
  hash: SnapshotHash.nullable(),
  /** False for files over 20 MB and for doc pointers: only the pointer and hash are kept. */
  snapshot: z.boolean(),
  /** True when the capture may be incomplete, as with a file read through a shell command. */
  partial: z.boolean(),
});
export type InputLine = z.infer<typeof InputLine>;

export const InputRemovedLine = LineEnvelope.extend({
  kind: z.literal("removed"),
  input: z.string().min(1).max(64),
  section: SectionId,
});
export type InputRemovedLine = z.infer<typeof InputRemovedLine>;

export const InputsLine = z.discriminatedUnion("kind", [InputLine, InputRemovedLine]);
export type InputsLine = z.infer<typeof InputsLine>;

/** The inputs still in force after every device's lines are merged: added, and not removed since. */
export function liveInputs(lines: readonly InputsLine[]): InputLine[] {
  const removed = new Set(
    lines.filter((l) => l.kind === "removed").map((l) => `${l.section}\u0000${l.input}`),
  );
  return lines.filter(
    (l): l is InputLine => l.kind === "input" && !removed.has(`${l.section}\u0000${l.input}`),
  );
}
