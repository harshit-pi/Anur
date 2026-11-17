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
});

/** An agent session this thread runs in; a new line each time one starts, resumes or is rebuilt. */
export const SessionLine = LineEnvelope.extend({
  kind: z.literal("session"),
  /** The agent's own session ID, which the hook sees on every call. */
  session: z.string().min(1),
  event: z.enum(["started", "resumed", "rebuilt"]),
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

export const KnownThreadLine = z.discriminatedUnion("kind", [
  ThreadStartLine,
  SessionLine,
  TurnLine,
  MessageLine,
  ToolLine,
  StateLine,
]);
export type KnownThreadLine = z.infer<typeof KnownThreadLine>;

const KNOWN_KINDS = new Set(["thread", "session", "turn", "message", "tool", "state"]);

/** A kind added by a later version of format 1; kept as written. */
export const OtherThreadLine = LineEnvelope.extend({ kind: z.string() })
  .loose()
  .refine((l) => !KNOWN_KINDS.has(l.kind), { message: "a known kind must match its own schema" });
export type OtherThreadLine = z.infer<typeof OtherThreadLine>;

export const ThreadLine = z.union([KnownThreadLine, OtherThreadLine]);
export type ThreadLine = z.infer<typeof ThreadLine>;
