import { z } from "zod";
import { PreviewPart } from "@anur/core";
import { AGENT_IDS } from "./agents.ts";

const AgentIdSchema = z.enum(AGENT_IDS);
import { INSERT_IDS } from "./insert-items.ts";

/**
 * Every message between the renderer and main, with its schema
 * (Architecture, "Processes"). Main checks each request against its schema
 * and the window that sent it before doing anything; the renderer can only
 * call channels listed here, and only hear events listed here.
 */

export const FolderState = z.object({
  name: z.string(),
  /** The folder's real path on this machine. */
  path: z.string(),
  mode: z.enum(["writable", "read-only"]),
  /** Why the folder is read-only; null when it is writable. */
  reason: z.string().nullable(),
  /** Its Markdown files, relative paths with forward slashes, sorted. */
  docs: z.array(z.string()),
  /** Folders holding docs at any depth, and empty ones; relative, sorted. */
  folders: z.array(z.string()),
  /** Each doc's last change and creation times, in ms, for sorting. */
  times: z.record(z.string(), z.tuple([z.number(), z.number()])),
  /** True when the folder had more files than Anur lists. */
  truncated: z.boolean(),
  /** The sync service that keeps the folder, if any. */
  cloud: z.enum(["icloud", "dropbox", "onedrive", "google-drive", "cloud"]).nullable(),
  /** A git repo inside a synced folder: sync is a known cause of git lock-file failures. */
  gitInCloud: z.boolean(),
  /** Docs whose bytes are still in iCloud; Anur fetches them before reading. */
  offloaded: z.array(z.string()),
  /** Sync conflict copies, each offered as a merge into its original. */
  conflicts: z.array(
    z.object({ original: z.string(), copy: z.string(), service: z.enum(["icloud", "dropbox"]) }),
  ),
});
export type FolderState = z.infer<typeof FolderState>;

/** Docs that moved, each from its old path to its new one. */
const Moves = z
  .array(z.object({ from: z.string().max(1024), to: z.string().max(1024) }))
  .max(20_000);

/** An item in a native menu: a choice, a line, or a submenu of more. */
export type MenuEntry =
  | { id: string; label: string; enabled?: boolean | undefined; checked?: boolean | undefined }
  | { separator: true }
  | { label: string; submenu: MenuEntry[] };
export const MenuEntry: z.ZodType<MenuEntry, MenuEntry> = z.lazy(() =>
  z.union([
    z.object({
      id: z.string().max(1024),
      label: z.string().max(200),
      enabled: z.boolean().optional(),
      checked: z.boolean().optional(),
    }),
    z.object({ separator: z.literal(true) }),
    z.object({ label: z.string().max(200), submenu: z.array(MenuEntry).max(300) }),
  ]),
);

/** Whether threads can run, and why not (Architecture, "When the agent is not connected"). */
export const AgentStatus = z.object({
  /** Which agent this is about. */
  id: AgentIdSchema,
  /** null until Anur has tried to connect. */
  connected: z.boolean().nullable(),
  reason: z.string().nullable(),
  agent: z.object({ agent: z.string(), adapter: z.string() }).nullable(),
});
export type AgentStatus = z.infer<typeof AgentStatus>;

/** Whether an agent is signed in, the sign-ins it offers, and one under way (3.16). */
export const AgentSignIn = z.object({
  agent: AgentIdSchema,
  auth: z.object({
    state: z.enum(["authenticated", "unauthenticated", "unknown"]),
    account: z.string().nullable(),
    methods: z.array(
      z.object({ id: z.string(), name: z.string(), description: z.string().nullable() }),
    ),
  }),
  signIn: z
    .object({
      phase: z.enum(["waiting", "failed"]),
      url: z.string().nullable(),
      message: z.string().nullable(),
    })
    .nullable(),
});
export type AgentSignIn = z.infer<typeof AgentSignIn>;

/** One item in a thread, as the Think panel shows it. */
export const ThreadItem = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message"),
    turn: z.string(),
    role: z.enum(["person", "agent"]),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("tool"),
    turn: z.string(),
    toolUse: z.string(),
    title: z.string(),
    status: z.string(),
  }),
  z.object({ kind: z.literal("error"), turn: z.string(), text: z.string() }),
  /** A doc written by something else while this thread's turn ran (3.11). */
  z.object({
    kind: z.literal("changed"),
    turn: z.string(),
    id: z.string(),
    path: z.string(),
    canRevert: z.boolean(),
    reverted: z.boolean(),
  }),
]);
export type ThreadItem = z.infer<typeof ThreadItem>;

/** A choice the agent offers for a thread's session: its mode or its model (3.5). */
export const SessionOption = z.object({
  id: z.string(),
  name: z.string(),
  current: z.string(),
  choices: z.array(
    z.object({ value: z.string(), name: z.string(), description: z.string().nullable() }),
  ),
});
export type SessionOption = z.infer<typeof SessionOption>;

/** A thread on one section: what it is about, what it read, and what was said. */
export const ThreadView = z.object({
  id: z.string(),
  /** The section's ID, and its heading path now; null when its section is gone. */
  section: z.string(),
  path: z.array(z.string()).nullable(),
  title: z.string(),
  closed: z.boolean(),
  busy: z.boolean(),
  /** What the agent reads in this thread: the bundle's parts, as the reads line lists them. */
  reads: z.array(z.object({ label: z.string(), detail: z.string() })),
  items: z.array(ThreadItem),
  /** The session's mode and model, once a session is open on this device. */
  options: z.array(SessionOption),
  /** The agent the thread runs on: its last session's, or the one picked for its next turn. */
  agent: AgentIdSchema,
});
export type ThreadView = z.infer<typeof ThreadView>;

/** One thread's proposed changes to the open doc, one part per section (3.8). */
export const PreviewView = z.object({
  thread: z.string(),
  /** The thread's question, which names the preview. */
  title: z.string(),
  parts: z.array(PreviewPart),
});
export type PreviewView = z.infer<typeof PreviewView>;

/** The section a thread is about: its index in the page's tree and its heading path, to check it. */
const SectionRef = z.object({ index: z.int().nonnegative(), path: z.array(z.string()).max(50) });

export const ipcContract = {
  "app:info": {
    request: z.object({}).strict(),
    response: z.object({
      name: z.string(),
      version: z.string(),
      formatVersion: z.int(),
      platform: z.enum(["darwin", "win32", "linux"]),
    }),
  },
  /** The folder this window has open, if any. */
  "folder:current": {
    request: z.object({}).strict(),
    response: FolderState.nullable(),
  },
  /** Ask the person to pick a folder, then open it in this window or bring forward the window that has it. */
  "folder:choose": {
    request: z.object({}).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("opened"), folder: FolderState }),
      z.object({ kind: z.literal("cancelled") }),
      z.object({ kind: z.literal("elsewhere") }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /** Read one of the folder's docs for the page; iCloud docs are downloaded first. */
  "doc:open": {
    request: z.object({ path: z.string() }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("doc"),
        path: z.string(),
        /** The text with "\n" line endings. */
        text: z.string(),
        mode: z.enum(["editable", "read-only", "plain-text"]),
        /** Something to tell the person once, such as mixed line endings. */
        note: z.string().nullable(),
        /** A hash of the file's bytes as read; a save must match it (compare-and-swap). */
        hash: z.string(),
      }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /**
   * Write the page's text, only if the file on disk still has the hash the
   * page last read or wrote. Otherwise it changed outside Anur and nothing is written.
   */
  "doc:save": {
    request: z.object({ path: z.string(), text: z.string(), base: z.string() }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("saved"), hash: z.string() }),
      z.object({ kind: z.literal("changed") }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /**
   * An embedded Obsidian base, `![[Ideas.base]]` or `![[Ideas.base#View]]`,
   * worked out over the folder's notes: each view as a table. Read-only.
   */
  /** An image a doc embeds, found as Obsidian finds it and read as a data URL (2.27). */
  "image:read": {
    request: z.object({ target: z.string().max(1024), from: z.string().max(4096) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("image"), path: z.string(), dataUrl: z.string() }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** Keep a pasted or dropped image in the folder, where Obsidian would put it (2.27). */
  "image:save": {
    request: z
      .object({
        from: z.string().max(4096),
        name: z.string().max(255),
        type: z.string().max(50),
        /** The image's bytes, base64. */
        data: z.string().max(36_000_000),
      })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("saved"), path: z.string(), name: z.string() }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  "base:read": {
    request: z.object({ target: z.string().max(1024), from: z.string().max(4096) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("base"),
        path: z.string(),
        /** The view the embed names after "#", if any. */
        view: z.string().nullable(),
        views: z.array(
          z.object({
            name: z.string(),
            columns: z.array(z.object({ id: z.string(), label: z.string() })),
            rows: z.array(
              z.object({
                path: z.string(),
                cells: z.array(z.object({ text: z.string(), link: z.string().nullable() })),
              }),
            ),
          }),
        ),
        problems: z.array(z.string()),
        /** Notes left out because their bytes are still in iCloud. */
        skipped: z.number(),
      }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** Settings main acts on (2.25): app-wide ones, and whether this window's folder commits `.anur/`. */
  "settings:get": {
    request: z.object({}).strict(),
    response: z.object({
      sectionHistory: z.boolean(),
      commitAnur: z.boolean().nullable(),
      defaultAgent: AgentIdSchema,
    }),
  },
  "settings:set": {
    request: z
      .object({
        sectionHistory: z.boolean().optional(),
        commitAnur: z.boolean().optional(),
        defaultAgent: AgentIdSchema.optional(),
      })
      .strict(),
    response: z.object({
      sectionHistory: z.boolean(),
      commitAnur: z.boolean().nullable(),
      defaultAgent: AgentIdSchema,
    }),
  },
  /** Search the folder's docs, case ignored: each matching line (2.26). */
  "folder:search": {
    request: z.object({ query: z.string().max(500) }).strict(),
    response: z.object({
      matches: z.array(
        z.object({ path: z.string(), line: z.int(), column: z.int(), text: z.string() }),
      ),
      truncated: z.boolean(),
      /** Docs left out because their bytes are still in iCloud. */
      skipped: z.int(),
    }),
  },
  /** Make a new doc at a Markdown path in the folder, with its title as its first line (2.26). */
  "doc:create": {
    request: z.object({ path: z.string().max(1024) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("created"), path: z.string(), folder: FolderState }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** A new, empty folder in the folder (files panel). */
  "folder:create": {
    request: z.object({ path: z.string().max(1024) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("created"), path: z.string(), folder: FolderState }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** Rename or move a doc or a folder; its docs keep their IDs, threads and history. */
  "file:move": {
    request: z.object({ from: z.string().max(1024), to: z.string().max(1024) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("moved"),
        to: z.string(),
        /** Each doc that moved, from its old path to its new one. */
        docs: z.array(z.object({ from: z.string(), to: z.string() })),
        folder: FolderState,
      }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** A copy of a doc beside it, named "<name> copy". */
  "file:duplicate": {
    request: z.object({ path: z.string().max(1024) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("created"), path: z.string(), folder: FolderState }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** Move a doc or a folder to the system Trash, where Finder can put it back. */
  "file:trash": {
    request: z.object({ path: z.string().max(1024) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("trashed"), docs: z.array(z.string()), folder: FolderState }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** How many links a rename or move broke, in how many docs. */
  "links:plan": {
    request: z.object({ moves: Moves }).strict(),
    response: z.object({ docs: z.number(), links: z.number() }),
  },
  /** Write those links again, so they reach their docs at the new paths. */
  "links:update": {
    request: z.object({ moves: Moves }).strict(),
    response: z.object({ docs: z.number(), links: z.number(), skipped: z.number() }),
  },
  /** Open a web or mail link in the system's browser or mail app. */
  "link:open-external": {
    request: z.object({ url: z.string().max(4096) }).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Put text on the clipboard, which works whether or not the window has focus. */
  "clipboard:write": {
    request: z.object({ text: z.string().max(100_000) }).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Show the doc in Finder, or open it in the app the system uses for Markdown. */
  "doc:reveal": {
    request: z.object({ path: z.string(), how: z.enum(["finder", "default-app"]) }).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Keep the person's version of lines a change made outside Anur overlapped (2.18). */
  "journal:keep": {
    request: z
      .object({
        path: z.string(),
        mine: z.string().max(1_000_000),
        theirs: z.string().max(1_000_000),
        before: z.string().max(10_000),
        after: z.string().max(10_000),
      })
      .strict(),
    response: z.object({ id: z.string() }),
  },
  /** The crash journal (2.20): a page's unsaved text, written every two seconds while it has some. */
  "recovery:write": {
    request: z
      .object({
        path: z.string(),
        text: z.string().max(20_000_000),
        saved: z.string().max(20_000_000),
      })
      .strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Typing is saved: nothing to recover. */
  "recovery:clear": {
    request: z.object({ path: z.string() }).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Typing journaled before a crash, for the page that opens the doc next. */
  "recovery:read": {
    request: z.object({ path: z.string() }).strict(),
    response: z.object({
      entry: z.object({ text: z.string(), saved: z.string(), at: z.string() }).nullable(),
    }),
  },
  /** Typing kept for a doc, oldest first. */
  "journal:list": {
    request: z.object({ path: z.string() }).strict(),
    response: z.object({
      entries: z.array(
        z.object({
          id: z.string(),
          path: z.string(),
          mine: z.string(),
          theirs: z.string(),
          before: z.string(),
          after: z.string(),
          at: z.string(),
        }),
      ),
    }),
  },
  /** Forget kept typing, once put back or dismissed. */
  "journal:drop": {
    request: z.object({ id: z.string() }).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Show a native context menu at the pointer; resolves with the chosen item's id, or null. */
  "menu:popup": {
    request: z.object({ items: z.array(MenuEntry).max(300) }).strict(),
    response: z.object({ id: z.string().nullable() }),
  },
  /** How a conflict copy would merge into its original, section by section. */
  "conflict:plan": {
    request: z.object({ copy: z.string() }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("plan"),
        original: z.string(),
        copy: z.string(),
        parts: z.array(
          z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("same"), path: z.array(z.string()), text: z.string() }),
            z.object({
              kind: z.literal("differs"),
              path: z.array(z.string()),
              original: z.string(),
              copy: z.string(),
            }),
            z.object({
              kind: z.literal("only-original"),
              path: z.array(z.string()),
              text: z.string(),
            }),
            z.object({ kind: z.literal("only-copy"), path: z.array(z.string()), text: z.string() }),
          ]),
        ),
        /** The two files as planned; the merge is refused if either changes before it runs. */
        hashes: z.object({ original: z.string(), copy: z.string() }),
      }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** Write the merge into the original, then move the copy to the Trash. */
  "conflict:merge": {
    request: z
      .object({
        copy: z.string(),
        hashes: z.object({ original: z.string(), copy: z.string() }),
        choices: z.record(
          z.string().regex(/^\d+$/),
          z.union([z.enum(["original", "copy"]), z.boolean()]),
        ),
      })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("merged"), folder: FolderState }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },

  /** Whether threads can run; asking connects the agent once (3.1). */
  "agent:status": {
    /** Without an agent, the default one. */
    request: z.object({ connect: z.boolean(), agent: AgentIdSchema.optional() }).strict(),
    response: AgentStatus,
  },
  /** The open doc's threads, each with its section's heading path in `text`. */
  "thread:list": {
    request: z.object({ path: z.string().max(4096), text: z.string() }).strict(),
    response: z.object({ threads: z.array(ThreadView) }),
  },
  /** Start a thread on a section with its first message (3.5). */
  "thread:start": {
    request: z
      .object({
        path: z.string().max(4096),
        text: z.string(),
        section: SectionRef,
        message: z.string().min(1).max(100_000),
        /** The agent to run it on; the default agent when left out. */
        agent: AgentIdSchema.optional(),
        /** Mode and model picked before the first message, set when its session opens. */
        options: z
          .array(z.object({ id: z.string().max(100), value: z.string().max(200) }))
          .max(10)
          .optional(),
      })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("started"), thread: ThreadView }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /** Send the next message in a thread. */
  "thread:send": {
    request: z
      .object({
        thread: z.string().max(200),
        path: z.string().max(4096),
        text: z.string(),
        message: z.string().min(1).max(100_000),
      })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("sent") }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /**
   * An agent's mode and model choices, for a thread with no session yet:
   * the last ones seen; asking refreshes them once per run, in the background.
   */
  "agent:options": {
    request: z.object({ agent: AgentIdSchema }).strict(),
    response: z.object({ options: z.array(SessionOption) }),
  },
  /** Whether the agent is signed in; asking reads it again, and the answer follows as an event. */
  "agent:auth": {
    request: z.object({ agent: AgentIdSchema }).strict(),
    response: AgentSignIn,
  },
  /** Run one of the agent's sign-ins; it opens the browser, and progress follows as events. */
  "agent:sign-in": {
    request: z.object({ agent: AgentIdSchema, method: z.string().max(100) }).strict(),
    response: z.object({}),
  },
  "agent:sign-in-cancel": {
    request: z.object({ agent: AgentIdSchema }).strict(),
    response: z.object({}),
  },
  /** Move a thread to another agent: its next turn starts there, from its bundle and chat. */
  "thread:agent": {
    request: z.object({ thread: z.string().max(200), agent: AgentIdSchema }).strict(),
    response: z.object({}),
  },
  /** Pick the thread's mode or model; it holds for the thread's session from now on. */
  "thread:option": {
    request: z
      .object({ thread: z.string().max(200), id: z.string().max(100), value: z.string().max(200) })
      .strict(),
    response: z.object({}),
  },
  /** Put back a doc that changed while the thread's turn ran, as it was before that change. */
  "thread:revert": {
    request: z.object({ thread: z.string().max(200), id: z.string().max(100) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("reverted") }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /** Stop the thread's running turn. */
  "thread:stop": {
    request: z.object({ thread: z.string().max(200) }).strict(),
    response: z.object({}),
  },
  /** The open doc's previews, each part with its section's heading path in `text`. */
  "preview:list": {
    request: z.object({ path: z.string().max(4096), text: z.string() }).strict(),
    response: z.object({ previews: z.array(PreviewView) }),
  },
  /** What is left of a thread's preview of the doc, after a person rejected or applied parts of it. */
  "preview:update": {
    request: z
      .object({
        path: z.string().max(4096),
        text: z.string(),
        thread: z.string().max(200),
        parts: z.array(PreviewPart).max(500),
      })
      .strict(),
    response: z.object({}),
  },
  /**
   * Unsaved typing clashed with a change made outside Anur: keep the
   * person's version as a "your unsaved edit" preview on its section (3.10).
   */
  "preview:unsaved": {
    request: z
      .object({ path: z.string().max(4096), text: z.string(), proposed: z.string() })
      .strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Before an Apply lands: its version, written to History first (3.9). */
  "preview:apply": {
    request: z
      .object({
        path: z.string().max(4096),
        text: z.string(),
        thread: z.string().max(200),
        section: z.string().max(200),
        applied: z.string(),
      })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ok") }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /** The person's answer to one of the agent's own prompts; null declines. */
  "thread:permission": {
    request: z
      .object({ request: z.string().max(300), option: z.string().max(300).nullable() })
      .strict(),
    response: z.object({}),
  },
} as const;

/** Events main sends to a window. */
export const ipcEvents = {
  /** This window's folder changed, as when opened from the menu. */
  "folder:changed": FolderState.nullable(),
  /** The open doc changed outside Anur: its new text, or that it is gone or no longer readable. */
  "doc:changed": z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("changed"), path: z.string(), text: z.string(), hash: z.string() }),
    z.object({ kind: z.literal("gone"), path: z.string() }),
    z.object({ kind: z.literal("unreadable"), path: z.string(), reason: z.string() }),
  ]),
  /** A menu-bar command for the window's page and tabs. */
  "app:command": z.object({
    command: z.enum(["tab-new", "tab-close", "back", "forward", "tab-next", "tab-prev"]),
  }),
  /** Insert in the menu bar: put this block where the page's cursor is. */
  "editor:insert": z.object({ id: z.enum(INSERT_IDS) }),
  /** The agent connected, or couldn't, and why. */
  "agent:status": AgentStatus,
  /** An agent's sign-in changed, or a sign-in moved on. */
  "agent:auth": AgentSignIn,
  /** An agent's mode and model choices were read again. */
  "agent:options": z.object({ agent: AgentIdSchema, options: z.array(SessionOption) }),
  /** Put this text on the open doc's page, as a Revert asks; the page saves it. */
  "doc:replace": z.object({ path: z.string(), text: z.string() }),
  /** Links in the open doc to write again after docs moved; the page does it, so ⌘Z undoes it. */
  "links:rewrite": z.object({
    path: z.string(),
    was: z.string(),
    moves: z.array(z.object({ from: z.string(), to: z.string() })),
    before: z.array(z.string()),
    after: z.array(z.string()),
  }),
  /** A doc's previews changed, as when a thread's turn ended with edits. */
  "preview:changed": z.object({ path: z.string() }),
  /** A thread changed: all of it, or a reply arriving piece by piece. */
  "thread:event": z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("thread"), path: z.string(), thread: ThreadView }),
    z.object({ kind: z.literal("text"), thread: z.string(), turn: z.string(), text: z.string() }),
    z.object({
      kind: z.literal("tool"),
      thread: z.string(),
      turn: z.string(),
      toolUse: z.string(),
      title: z.string(),
      status: z.string(),
    }),
    z.object({
      kind: z.literal("permission"),
      thread: z.string(),
      request: z.string(),
      title: z.string(),
      options: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() })),
    }),
  ]),
} as const;

export type Channel = keyof typeof ipcContract;
export type Request<C extends Channel> = z.input<(typeof ipcContract)[C]["request"]>;
export type Response<C extends Channel> = z.output<(typeof ipcContract)[C]["response"]>;
export type EventName = keyof typeof ipcEvents;
export type EventPayload<E extends EventName> = z.output<(typeof ipcEvents)[E]>;

export const CHANNELS = Object.keys(ipcContract) as Channel[];

export function isChannel(name: unknown): name is Channel {
  return typeof name === "string" && Object.hasOwn(ipcContract, name);
}

export function isEvent(name: unknown): name is EventName {
  return typeof name === "string" && Object.hasOwn(ipcEvents, name);
}

/** What the preload exposes on `window.anur`. */
export type AnurBridge = {
  call<C extends Channel>(channel: C, request: Request<C>): Promise<Response<C>>;
  /** Listen for an event from main; returns a function that stops listening. */
  on<E extends EventName>(event: E, listener: (payload: EventPayload<E>) => void): () => void;
};
