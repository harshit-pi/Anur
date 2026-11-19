import { z } from "zod";
import { SnapshotHash, ThreadId } from "../ids.ts";
import { LineEnvelope } from "../jsonl/lines.ts";
import { DocId, SectionId } from "../sections/section.ts";

/**
 * One line of `docs/<doc>/threads/<thread>/<device>.jsonl` (task 1.7): one
 * message or tool call, or a change to the thread itself. Nothing a thread
 * said is thrown away; only what a person applies enters the file.
 *
 * Within format 1 new kinds may be added later. An app reads a kind it
 * doesn't know as `OtherThreadLine` and keeps it, instead of dropping it.
 */

const Name = z.string().min(1).max(200);
const Version = z.object({ name: Name, version: z.string().min(1).max(100) });

/** The thread's first line: the section it is on and the question it is named by. */
export const ThreadStartLine = LineEnvelope.extend({
  kind: z.literal("thread"),
  thread: ThreadId,
  doc: DocId,
  section: SectionId,
  /** The question the thread is named by. */
  title: z.string(),
  /** How it began: a new thread, Ask on the whole doc, Start fresh, or a branch. */
  start: z.enum(["new", "ask", "fresh", "branch"]),
  /** For a branch: the thread and line it continues from. */
  branchedFrom: z.object({ thread: ThreadId, line: z.string() }).nullable(),
  /** An action thread (group 15): build the section, or check it; absent for thinking. */
  purpose: z.enum(["build", "check"]).optional(),
  /**
   * A thread exploring one option another thread offered: it starts clean,
   * with that option and the options it narrows, never the ones passed over.
   */
  explores: z
    .object({ thread: ThreadId, option: z.string().min(1) })
    .nullable()
    .optional(),
});

/** An agent session this thread runs in; a new line each time one starts, resumes or is rebuilt. */
export const SessionLine = LineEnvelope.extend({
  kind: z.literal("session"),
  /** The agent's own session ID, which the hook sees on every call. */
  session: z.string().min(1),
  event: z.enum(["started", "resumed", "rebuilt"]),
  /**
   * The agent the session runs on, such as "claude-code"; added within
   * format 1, so a line without it is Claude Code's. A thread moved to
   * another agent starts a new session there, rebuilt from its bundle and chat.
   */
  agent: z.string().min(1).max(64).optional(),
});

/** A turn starts with the versions in play, so a change in behaviour can be traced; it ends with why and what it cost. */
export const TurnLine = LineEnvelope.extend({
  kind: z.literal("turn"),
  turn: z.string().min(1),
  event: z.enum(["start", "end"]),
  agent: Version.nullable(),
  adapter: Version.nullable(),
  model: z.string().nullable(),
  stopReason: z.string().nullable(),
  /** Tokens, from the agent's usage report; null when it gave none. */
  usage: z
    .object({
      input: z.int().nonnegative(),
      output: z.int().nonnegative(),
      cacheRead: z.int().nonnegative(),
      cacheWrite: z.int().nonnegative(),
    })
    .nullable(),
  /**
   * The session's context at the turn's end, and the model's window, as the
   * agent last reported them (4.9); absent when it reported neither.
   */
  context: z
    .object({ used: z.int().nonnegative(), size: z.int().positive() })
    .nullable()
    .optional(),
});

export const MessageLine = LineEnvelope.extend({
  kind: z.literal("message"),
  turn: z.string().min(1),
  role: z.enum(["person", "agent"]),
  text: z.string(),
});

/** A tool call. Its result is stored once, as a snapshot, and the line points to it by hash. */
export const ToolLine = LineEnvelope.extend({
  kind: z.literal("tool"),
  turn: z.string().min(1),
  /** The agent's tool-use ID, the same one the hook sees. */
  toolUse: z.string().min(1),
  name: Name,
  input: z.json(),
  status: z.enum(["completed", "failed", "refused"]),
  result: SnapshotHash.nullable(),
});

/** Closing or reopening a thread; closed threads are hidden, never deleted by this. */
export const StateLine = LineEnvelope.extend({
  kind: z.literal("state"),
  state: z.enum(["open", "closed"]),
});

/**
 * Options the agent offered for its section, through Anur's
 * anur_offer_options tool: each is a whole new text for the section. They
 * live in the thread, never in the file, until the person picks one.
 */
export const OptionsLine = LineEnvelope.extend({
  kind: z.literal("options"),
  turn: z.string().min(1),
  options: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        text: z.string(),
        /** One line: what sets this option apart, shown on its map box. */
        why: z.string().optional(),
      }),
    )
    .min(1),
  /** The option being explored when these were offered: they are narrower choices within it. */
  within: z.string().min(1).nullable().optional(),
  /**
   * The decision these choose between, such as "Launch date", when it isn't
   * the section itself: the picked option goes under a subsection of this name.
   */
  heading: z.string().min(1).nullable().optional(),
  /** Parts that can all belong, such as workstreams: the person adds any number, not one. */
  several: z.boolean().optional(),
});

/**
 * The person picked an option: its text replaced the section's, or became a
 * subsection; "also" adds it beside the option already picked.
 */
export const OptionUsedLine = LineEnvelope.extend({
  kind: z.literal("option-used"),
  option: z.string().min(1),
  how: z.enum(["replace", "subsection", "also"]),
});

/**
 * Something the agent picked up with its own tools (4.3): a file it read, a
 * pointer to another doc, a command's output, a fetch's answer, another MCP
 * server's result. Its content is a snapshot, by hash; a doc is a pointer.
 */
export const InputLine = LineEnvelope.extend({
  kind: z.literal("input"),
  turn: z.string().min(1),
  toolUse: z.string().min(1),
  source: z.enum(["file", "doc", "command", "fetch", "search", "mcp"]),
  /** What the person and the agent see it as: a path, a command, a URL. */
  label: z.string(),
  /** Where it came from: a path in or out of the folder, a URL, a command, a server's tool. */
  ref: z.string(),
  hash: SnapshotHash.nullable(),
  /** Pages and search results are untrusted: text from the web, not from the person. */
  trust: z.enum(["trusted", "untrusted"]),
  /**
   * Its content is kept on the device that read it, never in `.anur/`: what
   * came from that person's machine outside the folder. Others see the label.
   */
  local: z.boolean().optional(),
});

/**
 * Something a person added for threads to work from (group 10): a file or a
 * mock attached, a file from the folder, or a link. On a section, it lives
 * in the doc's inputs file and reaches every thread on that section and
 * below; on a thread, in that thread's file, and from there new threads too.
 */
export const AddedInputLine = LineEnvelope.extend({
  kind: z.literal("added-input"),
  section: SectionId,
  /** The thread it was added to; null when added to the section. */
  thread: ThreadId.nullable(),
  /** An attachment copied into the folder, a file already in it, or a link. */
  source: z.enum(["attachment", "file", "link"]),
  label: z.string(),
  /** A path in the folder, or the link's address. */
  ref: z.string(),
  hash: SnapshotHash.nullable(),
  /** A link is text from the web: untrusted. */
  trust: z.enum(["trusted", "untrusted"]),
});

/** A person removed an input: it no longer reaches new threads (4.4). */
export const InputRemovedLine = LineEnvelope.extend({
  kind: z.literal("input-removed"),
  input: z.string().min(1),
});

/**
 * An agent's edit used as it landed, as the person's setting asks: in which
 * doc and sections. `undo` names what restores it while the app that made
 * it runs; null when the page applied it, where ⌘Z takes it back.
 */
export const AutoUsedLine = LineEnvelope.extend({
  kind: z.literal("auto-used"),
  doc: z.string(),
  sections: z.array(z.array(z.string())),
  undo: z.string().nullable(),
});

/** An edit this thread proposed to another doc, which shows it on its page. */
export const ProposedLine = LineEnvelope.extend({
  kind: z.literal("proposed"),
  doc: z.string(),
  sections: z.array(z.array(z.string())),
});

/** Use all (9.4): a thread's edits used across docs at once, with one Undo. */
export const UsedAllLine = LineEnvelope.extend({
  kind: z.literal("used-all"),
  docs: z.array(z.object({ doc: z.string(), sections: z.array(z.array(z.string())) })),
  /** Edits that clashed with the text and stay proposals, as "doc › section". */
  kept: z.array(z.string()),
  undo: z.string().nullable(),
});

/**
 * How far a kept decision or finding reaches (18.3): its section and those
 * below, the whole doc, every doc in its folder or repo, or every folder the
 * person opens.
 */
export const DecisionScope = z.enum(["section", "doc", "folder", "everywhere"]);
export type DecisionScope = z.infer<typeof DecisionScope>;

/**
 * A finding (16.1): a claim a thread established, with the source it came
 * from, proposed by the agent. It carries to later threads only once a
 * person keeps it.
 */
export const FindingLine = LineEnvelope.extend({
  kind: z.literal("finding"),
  turn: z.string().min(1),
  claim: z.string().min(1),
  /** Where it came from: a file, a doc, a page; null when the agent gave none. */
  source: z.string().nullable(),
  /**
   * Who stands behind it: a source (a finding), or a person (a decision).
   * Left out on findings written before decisions existed: a source.
   */
  by: z.enum(["source", "person"]).optional(),
  /** A decision's exact words, as the person typed them in this thread. */
  quote: z.string().optional(),
  /** The person message the quote is from, so the card links to it. */
  from: z.string().nullable().optional(),
  /** What it was decided instead of, when the person said or turned one down. */
  instead: z.string().nullable().optional(),
  /** When it stops holding, in the person's words ("until 4.8 ships"). */
  until: z.string().nullable().optional(),
  /**
   * What a decision is about: "work" for how the agent works (its tools,
   * services, where work happens), which never shapes what the doc says;
   * "subject" for the plan or product itself. Subject when left out.
   */
  concerns: z.enum(["work", "subject"]).optional(),
  /** How far the agent judged it reaches, from the person's words (18.3); the section when left out. */
  scope: DecisionScope.optional(),
  /** The kept decision this one goes against (18.4), by its ID: neither wins until someone picks. */
  against: z.string().max(64).optional(),
});

/** A person's decision on a finding: kept (perhaps reworded), or dropped. */
export const FindingDecidedLine = LineEnvelope.extend({
  kind: z.literal("finding-decided"),
  finding: z.string().min(1),
  status: z.enum(["kept", "dropped"]),
  /** The claim as the person kept it, when they reworded it. */
  claim: z.string().nullable(),
  /** "auto" when a decision settled by itself, shown with Undo; a person's Keep otherwise. */
  how: z.enum(["person", "auto"]).optional(),
  /** How far it reaches, as the person set it (18.3); the finding's own when left out. */
  scope: DecisionScope.optional(),
  /** Kept again after its "until" passed (18.2): the new one, null for none; the finding's own when left out. */
  until: z.string().max(200).nullable().optional(),
});

/** An auto-used edit taken back from its note. */
export const AutoUndoneLine = LineEnvelope.extend({
  kind: z.literal("auto-undone"),
  used: z.string().min(1),
});

/** The person renamed the thread; the latest name wins. */
export const RenamedLine = LineEnvelope.extend({
  kind: z.literal("renamed"),
  title: z.string().min(1).max(200),
  /** The agent names a thread once, after its first reply; a person's name always wins. */
  by: z.enum(["person", "agent"]).optional(),
});

/** A check of the section (15.5): each claim, what the agent found, and where. */
export const CheckLine = LineEnvelope.extend({
  kind: z.literal("check"),
  turn: z.string().min(1),
  claims: z.array(
    z.object({
      claim: z.string(),
      verdict: z.enum(["holds", "wrong", "unsupported", "missing"]),
      source: z.string(),
      note: z.string(),
      /** A claim of fact, or a wording slip; older lines have none and read as fact. */
      about: z.enum(["fact", "wording"]).optional(),
    }),
  ),
  /** Whether it proposed corrected text, as the thread's edit. */
  corrected: z.boolean(),
});

/** A doc an agent made (15.6): kept in the folder; `undo` restores while the app runs. */
export const CreatedLine = LineEnvelope.extend({
  kind: z.literal("created"),
  doc: z.string(),
  undo: z.string().nullable(),
});

/** The person chose to explore an option before picking: the thread digs into it. */
export const OptionExploredLine = LineEnvelope.extend({
  kind: z.literal("option-explored"),
  option: z.string().min(1),
});

/**
 * An action the agent proposes and doesn't run (Mock 10): a planned box on
 * the map with ▶ Run, which starts a Build on its section with `what`.
 */
export const ActionProposedLine = LineEnvelope.extend({
  kind: z.literal("action-proposed"),
  turn: z.string().min(1),
  action: z.string().min(1),
  title: z.string().min(1),
  what: z.string().min(1),
  /** The section it acts on, by heading path; the thread's own when left out. */
  path: z.array(z.string()).nullable().optional(),
});

/** A proposed action was run: the Build thread that carries it out. */
export const ActionRunLine = LineEnvelope.extend({
  kind: z.literal("action-run"),
  action: z.string().min(1),
  thread: z.string().min(1),
});

export const KnownThreadLine = z.discriminatedUnion("kind", [
  ThreadStartLine,
  SessionLine,
  TurnLine,
  MessageLine,
  ToolLine,
  StateLine,
  OptionsLine,
  OptionUsedLine,
  OptionExploredLine,
  InputLine,
  InputRemovedLine,
  AddedInputLine,
  AutoUsedLine,
  AutoUndoneLine,
  RenamedLine,
  CheckLine,
  CreatedLine,
  ProposedLine,
  UsedAllLine,
  FindingLine,
  FindingDecidedLine,
  ActionProposedLine,
  ActionRunLine,
]);
export type KnownThreadLine = z.infer<typeof KnownThreadLine>;

const KNOWN_KINDS = new Set([
  "thread",
  "session",
  "turn",
  "message",
  "tool",
  "state",
  "options",
  "option-used",
  "option-explored",
  "input",
  "input-removed",
  "added-input",
  "auto-used",
  "auto-undone",
  "renamed",
  "check",
  "created",
  "proposed",
  "used-all",
  "finding",
  "finding-decided",
]);

/** A kind added by a later version of format 1; kept as written. */
export const OtherThreadLine = LineEnvelope.extend({ kind: z.string() })
  .loose()
  .refine((l) => !KNOWN_KINDS.has(l.kind), { message: "a known kind must match its own schema" });
export type OtherThreadLine = z.infer<typeof OtherThreadLine>;

export const ThreadLine = z.union([KnownThreadLine, OtherThreadLine]);
export type ThreadLine = z.infer<typeof ThreadLine>;
