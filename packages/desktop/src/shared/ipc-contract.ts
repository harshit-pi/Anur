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
  /** Attachments shown beside docs: images, PDFs, audio, video, canvases and bases. */
  files: z.array(z.string()),
  /** Each doc and file's last change and creation times, in ms, for sorting. */
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
/** A task's change report (group 21), as `@anur/system` writes it. */
export const TaskReportView = z.object({
  id: z.string(),
  session: z.string(),
  prompt: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  repos: z.array(
    z.object({ dir: z.string(), from: z.string().nullable(), to: z.string().nullable() }),
  ),
  lines: z.array(
    z.object({
      category: z.enum(["data", "auth", "calls", "ui", "other"]),
      repo: z.string(),
      part: z.string().nullable(),
      file: z.string(),
      line: z.number().nullable(),
      text: z.string(),
      how: z.enum(["added", "changed", "deleted"]),
      calls: z.array(z.string()).optional(),
    }),
  ),
  choices: z.array(z.string()),
  /** Decisions the change goes against (24.1); absent until checked. */
  against: z
    .array(
      z.object({
        target: z.string(),
        decision: z.string(),
        who: z.string().nullable(),
        at: z.string(),
        why: z.string(),
        confidence: z.number(),
        file: z.string().nullable(),
        line: z.number().nullable(),
        status: z.enum(["asserted", "asked", "confirmed", "dismissed"]),
      }),
    )
    .optional(),
});

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
  /** A file or folder the person attached to their next message (10.4). */
  z.object({ kind: z.literal("attached"), source: z.string(), label: z.string() }),
  z.object({
    kind: z.literal("message"),
    turn: z.string(),
    role: z.enum(["person", "agent"]),
    text: z.string(),
    /** Who wrote a person's message, when it isn't the one reading. */
    by: z.string().nullable().optional(),
    /** When it was written, shown on hover under a person's message. */
    at: z.string().optional(),
  }),
  z.object({
    kind: z.literal("tool"),
    turn: z.string(),
    toolUse: z.string(),
    title: z.string(),
    status: z.string(),
  }),
  z.object({ kind: z.literal("error"), turn: z.string(), text: z.string() }),
  /** Options the agent offered for the section; `used` is the one picked, if any. */
  z.object({
    kind: z.literal("options"),
    turn: z.string(),
    options: z.array(
      z.object({ id: z.string(), title: z.string(), text: z.string(), why: z.string().optional() }),
    ),
    used: z.string().nullable(),
    /** The options the person chose to explore before picking. */
    explored: z.array(z.string()),
    /** The explored option these are narrower choices within; null for a first set. */
    within: z.string().nullable(),
    /** The decision these choose between, as a subsection's name; null when it's the section itself. */
    heading: z.string().nullable(),
    /** Parts that can all belong: each is added on its own, and \`used\` stays null. */
    several: z.boolean(),
    /** Every option put into the doc from this set. */
    added: z.array(z.string()),
  }),
  /** An action the agent proposed and didn't run (Mock 10): ▶ Run starts it. */
  z.object({
    kind: z.literal("proposed-action"),
    id: z.string(),
    title: z.string(),
    what: z.string(),
    /** The section it acts on; null for the thread's own. */
    path: z.array(z.string()).nullable(),
    /** The Build thread that ran it, once run. */
    run: z.string().nullable(),
    /** The service the agent said will do it ("gmail"), so its mark shows before it runs. */
    service: z.string().nullable().optional(),
  }),
  /** A check of the section (15.5): each claim, its verdict and source. */
  z.object({
    kind: z.literal("check"),
    turn: z.string(),
    claims: z.array(
      z.object({
        claim: z.string(),
        verdict: z.enum(["holds", "wrong", "unsupported", "missing"]),
        source: z.string(),
        note: z.string(),
        about: z.enum(["fact", "wording"]).optional(),
      }),
    ),
    corrected: z.boolean(),
  }),
  /** A doc the agent made (15.6), kept in the folder; `undoable` while Undo can remove it. */
  z.object({
    kind: z.literal("created"),
    id: z.string(),
    doc: z.string(),
    undoable: z.boolean(),
    /** Taken back with Undo; `undoable` alone is false too after a restart. */
    undone: z.boolean().optional(),
  }),
  /** Use all (9.4): edits used across docs at once; `undoable` while one Undo can take them back. */
  z.object({
    kind: z.literal("used-all"),
    id: z.string(),
    docs: z.array(z.object({ doc: z.string(), sections: z.array(z.array(z.string())) })),
    kept: z.array(z.string()),
    undoable: z.boolean(),
    undone: z.boolean(),
  }),
  /** A finding (16.1): proposed by the agent, then kept or dropped by a person. */
  z.object({
    kind: z.literal("finding"),
    id: z.string(),
    claim: z.string(),
    source: z.string().nullable(),
    status: z.enum(["proposed", "kept", "dropped"]),
    /** How far it reaches (18.3). */
    scope: z.enum(["section", "doc", "folder", "everywhere"]).optional(),
    /** A person's decision, not a source's finding: their words, who (null for you), and so on. */
    by: z.literal("person").optional(),
    quote: z.string().nullable().optional(),
    instead: z.string().nullable().optional(),
    until: z.string().nullable().optional(),
    who: z.string().nullable().optional(),
    /** It settled by itself; the card offers Undo. */
    auto: z.boolean().optional(),
  }),
  /** An edit this thread proposed to another doc: shown on that doc's page. */
  z.object({
    kind: z.literal("proposed"),
    doc: z.string(),
    sections: z.array(z.array(z.string())),
  }),
  /** An edit used as it landed (the setting); `undoable` while its Undo can still restore it. */
  z.object({
    kind: z.literal("auto-used"),
    id: z.string(),
    doc: z.string(),
    sections: z.array(z.array(z.string())),
    undoable: z.boolean(),
    undone: z.boolean(),
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
/** A pen stroke on the map: points relative to the box it's anchored to. */
export const InkStrokeSchema = z.object({
  id: z.string().max(64),
  anchor: z.string().max(200).nullable(),
  pts: z.array(z.tuple([z.number(), z.number()])).max(5000),
  color: z.string().max(32),
});
export type InkStroke = z.infer<typeof InkStrokeSchema>;

export const ThreadView = z.object({
  id: z.string(),
  /** The section's ID, and its heading path now; null when its section is gone. */
  section: z.string(),
  path: z.array(z.string()).nullable(),
  title: z.string(),
  closed: z.boolean(),
  busy: z.boolean(),
  /** When anything last happened in it, and the start of its last reply, for the list. */
  lastAt: z.string().nullable().optional(),
  lastReply: z.string().nullable().optional(),
  /** For a branch (10.5): the thread it came from, and that thread's name. */
  branchedFrom: z
    .object({
      thread: z.string(),
      title: z.string(),
      /** The parent's item it branched after; its chat up to there shows above the branch's own. */
      upTo: z.number().optional(),
    })
    .nullable()
    .optional(),
  /** Every edit this thread proposes now, by doc and section (9.3). */
  changeSet: z
    .array(z.object({ doc: z.string(), sections: z.array(z.array(z.string())) }))
    .optional(),
  /** When the running turn started (ms since epoch); null while idle. */
  busySince: z.number().nullable().optional(),
  /** What the agent reads in this thread: the bundle's parts, as the reads line lists them. */
  reads: z.array(z.object({ label: z.string(), detail: z.string() })),
  items: z.array(ThreadItem),
  /** The session's mode and model, once a session is open on this device. */
  options: z.array(SessionOption),
  /** The agent the thread runs on: its last session's, or the one picked for its next turn. */
  /**
   * Tokens from the agent's usage reports (4.10): all the thread has used,
   * and how big its context was on the last turn; null before any report.
   */
  tokens: z
    .object({
      used: z.int().nonnegative(),
      /** Of `used`, what was read back from the prompt cache, at a fraction of the price. */
      cached: z.int().nonnegative().optional(),
      context: z.int().nonnegative(),
      /** The context after the first turn: the meter counts growth from here (4.9). */
      first: z.int().nonnegative(),
      /** The model's window, as the agent reported it; null when it never did. */
      window: z.int().positive().nullable(),
    })
    .nullable(),
  /** An action thread (group 15), or null for thinking. */
  purpose: z.enum(["build", "check"]).nullable(),
  /** The option this thread explores: another thread's, which it hangs off on the map. */
  explores: z.object({ thread: z.string(), option: z.string() }).nullable().optional(),
  /**
   * An action's state on the map (Mock 10), for a Build or Check: running,
   * waiting on the person (with the prompt to answer), or how it ended.
   */
  action: z
    .object({
      state: z.enum(["running", "needs", "done", "failed", "stopped"]),
      detail: z.string(),
      /** The plan or question waiting on the person, and the option that approves it. */
      ask: z.object({ request: z.string(), option: z.string() }).nullable(),
    })
    .nullable()
    .optional(),
  /** Who started it, when it isn't the one reading; null for their own. */
  by: z.string().nullable().optional(),
  /** When it started (ISO). */
  startedAt: z.string().optional(),
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

const FeatureFlagsSchema = z.object({
  links: z.boolean(),
  history: z.boolean(),
  actions: z.boolean(),
});

/** Where an update stands; "off" in Anur Dev, which doesn't update itself. */
export const UpdateState = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("idle"), checkedAt: z.string().nullable() }),
  z.object({ kind: z.literal("checking") }),
  z.object({
    kind: z.literal("available"),
    version: z.string(),
    notes: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("downloading"),
    version: z.string(),
    percent: z.number(),
    notes: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("ready"),
    version: z.string(),
    notes: z.array(z.string()).optional(),
  }),
  z.object({ kind: z.literal("error"), reason: z.string() }),
]);
export type UpdateState = z.infer<typeof UpdateState>;

/** A plugin as the marketplace shows it (Plugins and Git mock). */
const MarketPlugin = z.object({
  id: z.string(),
  name: z.string(),
  what: z.string(),
  version: z.string(),
  settings: z.array(
    z.object({
      type: z.enum(["toggle", "choice", "text"]),
      key: z.string(),
      label: z.string(),
      detail: z.string().optional(),
      choices: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    }),
  ),
  actions: z.array(z.object({ id: z.string(), label: z.string() })),
  openFrom: z.object({ label: z.string() }).nullable(),
});
export type MarketPlugin = z.infer<typeof MarketPlugin>;

/** A plugin's item in the status bar and the panel a click opens. */
const PluginStatusSchema = z.object({
  text: z.string(),
  tone: z.enum(["ok", "busy", "warn"]).optional(),
  lines: z
    .array(z.object({ label: z.string(), value: z.string(), href: z.string().optional() }))
    .optional(),
  actions: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
});
export type PluginStatusView = z.infer<typeof PluginStatusSchema>;

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
  /**
   * Spaces on this Mac (spaces), most recent first: each one's name, path, and
   * whether it syncs with GitHub. Recent folders that are no longer spaces are left out.
   */
  "spaces:list": {
    request: z.object({}).strict(),
    response: z.object({
      spaces: z.array(z.object({ path: z.string(), name: z.string(), github: z.boolean() })),
    }),
  },
  /** Opens a space by its path, in this window, or its own window if this one has one. */
  "spaces:open": {
    request: z.object({ path: z.string().max(4096) }).strict(),
    response: z.object({ error: z.string().nullable() }),
  },
  /** The space this window is opening now, by name, as at launch; null when none is. */
  "folder:opening": {
    request: z.object({}).strict(),
    response: z.object({ name: z.string().nullable() }),
  },
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
  /** Make a new folder where the person picks, then open it, empty, to start writing. */
  "folder:new": {
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
  /** An Excalidraw drawing, by an embed's name or a path: its scene as JSON. */
  "drawing:read": {
    request: z.object({ target: z.string().max(1024), from: z.string().max(4096) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("drawing"),
        path: z.string(),
        scene: z.string(),
        editable: z.boolean(),
      }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** A new drawing beside a doc, named as given (a number added if taken), holding this scene. */
  "drawing:create": {
    request: z
      .object({
        near: z.string().max(4096),
        name: z.string().max(200),
        scene: z.string().max(50_000_000),
      })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("created"), path: z.string() }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** A drawing's new scene, written back in the file's own format. */
  "drawing:save": {
    request: z.object({ path: z.string().max(4096), scene: z.string().max(50_000_000) }).strict(),
    response: z.object({ ok: z.boolean(), reason: z.string().nullable() }),
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
      commitAnur: z.boolean().nullable(),
      defaultAgent: AgentIdSchema,
      autoApply: z.boolean(),
      /** The name others see on this person's threads. */
      name: z.string(),
    }),
  },
  "settings:set": {
    request: z
      .object({
        commitAnur: z.boolean().optional(),
        defaultAgent: AgentIdSchema.optional(),
        autoApply: z.boolean().optional(),
        /** Empty goes back to git's name, else the Mac's. */
        name: z.string().max(80).optional(),
      })
      .strict(),
    response: z.object({
      commitAnur: z.boolean().nullable(),
      defaultAgent: AgentIdSchema,
      autoApply: z.boolean(),
      /** The name others see on this person's threads. */
      name: z.string(),
    }),
  },
  /** Rename a thread, so the person can tell it apart in Think and on the map. */
  "thread:rename": {
    request: z
      .object({
        thread: z.string().max(200),
        path: z.string().max(4096),
        text: z.string(),
        title: z.string().max(400),
      })
      .strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /**
   * Settings, Storage (11.5, 11.6): what `.anur/` holds by kind, what Clean
   * up would remove, which other devices hold it off, and attachments
   * nothing uses.
   */
  "storage:read": {
    request: z.object({}).strict(),
    response: z.object({
      kinds: z.array(z.object({ kind: z.string(), bytes: z.number(), files: z.number() })),
      cleanable: z.object({ count: z.number(), bytes: z.number() }),
      /** Other devices open now or that didn't quit cleanly: when each last opened the folder. */
      blockedBy: z.array(z.object({ openedAt: z.string().nullable() })),
      attachments: z.array(z.object({ path: z.string(), bytes: z.number() })),
    }),
  },
  /** Clean up (11.5): remove snapshots unused for 30 days that nothing points to. */
  "storage:clean": {
    request: z.object({}).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ok"), removed: z.number() }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /** Move one unused attachment to the system trash (11.6). */
  "attachment:trash": {
    request: z.object({ path: z.string().max(4096) }).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Plugins Anur ships, and whether each is on for this window's folder (19.4). */
  "plugins:list": {
    request: z.object({}).strict(),
    response: z.object({
      folder: z.string().nullable(),
      plugins: z.array(
        z.object({ id: z.string(), name: z.string(), what: z.string(), on: z.boolean() }),
      ),
    }),
  },
  /**
   * Sections from plugins' section sources for this window's folder, read in
   * the index process: the engineering plugin's repos, groups and parts (group 20).
   */
  "system:sections": {
    request: z.object({}).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("off") }),
      z.object({
        kind: z.literal("ok"),
        /** The folder this read is of, so a tab can keep it for that folder only. */
        folder: z.string(),
        /** The last saved read, shown while a fresh one runs; it follows as system:changed. */
        updating: z.boolean(),
        sections: z.array(
          z.object({
            id: z.string(),
            path: z.array(z.string()),
            text: z.string(),
            parent: z.string().nullable(),
          }),
        ),
        /** Edges between parts and repos (group 22), each with the person's choice on it. */
        edges: z.array(
          z.object({
            id: z.string(),
            from: z.string(),
            to: z.string(),
            kind: z.string(),
            label: z.string(),
            how: z.enum(["found", "guessed"]),
            evidence: z.string().nullable(),
            declared: z.string().nullable(),
            state: z.enum(["shown", "hidden", "confirmed"]),
            /** Decisions and kept findings on this edge, from the repos at both its ends (23.10). */
            decisions: z.array(
              z.object({
                id: z.string(),
                kind: z.enum(["decision", "finding"]),
                text: z.string(),
                who: z.string().nullable(),
                /** The repo it's kept in, from the opened folder. */
                repo: z.string(),
              }),
            ),
          }),
        ),
        /** Every repo found in the folder, and whether it's in the system (the person's choice). */
        /** Every repo folder; a second clone of one names the folder the map reads instead. */
        repos: z.array(
          z.object({ dir: z.string(), included: z.boolean(), copyOf: z.string().nullable() }),
        ),
        /** Each box's decisions on the map, and how many disagree (29.9), by box ID. */
        counts: z.record(z.string(), z.object({ decided: z.number(), disagree: z.number() })),
        /** Repos whose pre-commit hook isn't rebuilding their CLAUDE.md block, and why (23.8). */
        hooks: z.array(z.object({ repo: z.string(), why: z.string(), fix: z.boolean() })),
        /** What each edge detector can't see. */
        misses: z.array(z.object({ detector: z.string(), misses: z.array(z.string()) })),
        /** Claude's proposals waiting on the person, and the parts they have seen (20.6). */
        review: z.object({
          pending: z.array(
            z.object({ group: z.string(), name: z.string(), merge: z.array(z.string()) }),
          ),
          reviewed: z.array(z.string()),
          asking: z.boolean(),
          askingSince: z.string().nullable(),
          failed: z.string().nullable(),
        }),
      }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** Leave a repo out of this folder's system, or put it back; nothing reads a left-out repo. */
  "system:repo": {
    request: z.object({ repo: z.string().max(4096), include: z.boolean() }).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Hide an edge, show it again, or confirm it (22.3); kept across rescans. */
  "system:edge": {
    request: z
      .object({ edge: z.string().max(1000), action: z.enum(["hide", "show", "confirm"]) })
      .strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Put Anur's lines back in a repo's pre-commit hook (23.8). */
  "system:hook": {
    request: z.object({ repo: z.string().max(4096) }).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Ask Claude again for group names, after a failed ask (20.6). */
  "system:propose": {
    request: z.object({}).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /**
   * The person's answer on a group (20.6a): accept Claude's proposal, rename
   * it, or dismiss the proposal; and the parts it holds count as seen (20.6b).
   */
  "system:decide": {
    request: z
      .object({
        group: z.string().max(400),
        action: z.enum(["accept", "rename", "dismiss"]),
        name: z.string().max(60).optional(),
        parts: z.array(z.string().max(400)).max(5000),
      })
      .strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Parts the person has seen, without naming anything (20.6b). */
  "system:reviewed": {
    request: z.object({ parts: z.array(z.string().max(400)).max(5000) }).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Close or reopen a thread (11.3): closed ones are hidden until a person shows them. */
  "thread:close": {
    request: z
      .object({
        thread: z.string().max(200),
        path: z.string().max(4096),
        text: z.string(),
        closed: z.boolean(),
      })
      .strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Delete a thread and its previews, at once (11.3). */
  "thread:delete": {
    request: z.object({ thread: z.string().max(200) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ok") }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /**
   * The open doc's orphans (11.1): sections whose heading is gone, with the
   * threads and history behind them, and the live section most like each.
   */
  "orphans:list": {
    request: z.object({ path: z.string().max(4096), text: z.string() }).strict(),
    response: z.object({
      orphans: z.array(
        z.object({
          id: z.string(),
          path: z.array(z.string()),
          threads: z.array(z.object({ id: z.string(), title: z.string() })),
          history: z.boolean(),
          suggestion: SectionRef.nullable(),
        }),
      ),
    }),
  },
  /** Reattach an orphan to a live section (11.1): its threads and history move there. */
  "orphans:reattach": {
    request: z
      .object({
        path: z.string().max(4096),
        text: z.string(),
        orphan: z.string().max(200),
        section: SectionRef,
      })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ok") }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /** Delete an orphan's threads, previews, inputs and history, at once (11.2). */
  "orphans:delete": {
    request: z
      .object({ path: z.string().max(4096), text: z.string(), orphan: z.string().max(200) })
      .strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Take back a doc the agent made: removed, while it is as the agent left it. */
  "thread:undo-created": {
    request: z.object({ thread: z.string().max(200), id: z.string().max(100) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("undone") }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /** Take back an edit used as it landed, from its note in the thread. */
  "thread:auto-undo": {
    request: z.object({ thread: z.string().max(200), id: z.string().max(100) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("undone") }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /** The page used an agent's edit by itself, as Settings asks: the thread notes it. */
  "thread:auto-used": {
    request: z
      .object({
        thread: z.string().max(200),
        path: z.string().max(4096),
        text: z.string(),
        section: z.array(z.string()).max(50),
      })
      .strict(),
    response: z.object({}),
  },
  /** Search the folder's docs, case ignored: each matching line (2.26). */
  /**
   * Plugins from Anur's feed (Plugins and Git mock): the feed's list, those
   * installed here, which are on for this folder, and whether they update
   * themselves. `error` says why the feed couldn't be read.
   */
  "market:list": {
    request: z.object({ fresh: z.boolean().optional() }).strict(),
    response: z.object({
      feed: z.array(MarketPlugin),
      installed: z.array(MarketPlugin),
      on: z.array(z.string()),
      autoUpdate: z.boolean(),
      error: z.string().nullable(),
      inICloud: z.boolean(),
    }),
  },
  "market:install": {
    request: z.object({ id: z.string() }).strict(),
    response: z.object({ error: z.string().nullable() }),
  },
  "market:uninstall": {
    request: z.object({ id: z.string() }).strict(),
    response: z.object({ error: z.string().nullable() }),
  },
  "market:set": {
    request: z
      .object({
        id: z.string().optional(),
        on: z.boolean().optional(),
        autoUpdate: z.boolean().optional(),
      })
      .strict(),
    response: z.object({ error: z.string().nullable() }),
  },
  /** One plugin's settings for this folder, as values by key. */
  "plugin:settings": {
    request: z.object({ id: z.string() }).strict(),
    response: z.object({
      values: z.record(z.string(), z.union([z.string(), z.boolean()])),
      /** Its settings stay on this Mac, out of git, rather than going with the folder. */
      onMac: z.boolean(),
    }),
  },
  /** Keeps a plugin's settings on this Mac (a line in .anur/.gitignore), or commits them again. */
  "plugin:keep-on-mac": {
    request: z.object({ id: z.string(), onMac: z.boolean() }).strict(),
    response: z.object({}),
  },
  "plugin:set-setting": {
    request: z
      .object({ id: z.string(), key: z.string(), value: z.union([z.string(), z.boolean()]) })
      .strict(),
    response: z.object({}),
  },
  "plugin:action": {
    request: z.object({ id: z.string(), action: z.string() }).strict(),
    response: z.object({ message: z.string().nullable() }),
  },
  /** Every plugin's status-bar item for this window's folder, as last reported. */
  "plugin:statuses": {
    request: z.object({}).strict(),
    response: z.object({
      items: z.array(z.object({ plugin: z.string(), status: PluginStatusSchema })),
    }),
  },
  /** Folders installed plugins can open from elsewhere, such as GitHub. */
  "open-from:list": {
    request: z.object({}).strict(),
    response: z.object({
      sources: z.array(
        z.object({
          plugin: z.string(),
          label: z.string(),
          items: z.array(z.object({ id: z.string(), label: z.string(), detail: z.string() })),
        }),
      ),
      error: z.string().nullable(),
    }),
  },
  "open-from:open": {
    request: z.object({ plugin: z.string(), id: z.string() }).strict(),
    response: z.object({ error: z.string().nullable() }),
  },
  /** Everyone who works in the open folder (people): their handle and the name they go by. */
  "people:list": {
    request: z.object({}).strict(),
    response: z.object({
      people: z.array(z.object({ handle: z.string().nullable(), name: z.string() })),
    }),
  },
  "folder:search": {
    request: z.object({ query: z.string().max(500) }).strict(),
    response: z.object({
      matches: z.array(
        z.object({
          path: z.string(),
          line: z.int(),
          column: z.int(),
          text: z.string(),
          /** How long the match at `column` is, to select on opening. */
          length: z.int().optional(),
        }),
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
        /** Each doc and file that moved, from its old path to its new one. */
        docs: z.array(z.object({ from: z.string(), to: z.string() })),
        folder: FolderState,
      }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** A copy of a doc or file beside it, named "<name> copy". */
  "file:duplicate": {
    request: z.object({ path: z.string().max(1024) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("created"), path: z.string(), folder: FolderState }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** Copy files or folders from outside, as dropped or pasted from Finder, into a folder. */
  "file:import": {
    request: z
      .object({ sources: z.array(z.string().max(4096)).max(1000), into: z.string().max(1024) })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("copied"), paths: z.array(z.string()), folder: FolderState }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** Move a doc or a folder to the system Trash, where Finder can put it back. */
  "file:trash": {
    request: z.object({ path: z.string().max(1024) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("trashed"),
        docs: z.array(z.string()),
        /** Where it landed in the Trash, for Undo; null when that isn't known. */
        trashed: z.string().nullable(),
        folder: FolderState,
      }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** Undo a trash: move the item back from the Trash to where it was. */
  "file:restore": {
    request: z.object({ path: z.string().max(1024), trashed: z.string().max(4096) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("restored"), path: z.string(), folder: FolderState }),
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
  /** What another app dropped or pasted that isn't plain files: addresses, links, text. */
  "file:incoming": {
    request: z
      .object({
        into: z.string().max(1024),
        uriList: z.string().max(100_000),
        text: z.string().max(1_000_000),
        obsidianFiles: z.string().max(100_000),
      })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("copied"), paths: z.array(z.string()), folder: FolderState }),
      z.object({ kind: z.literal("made"), path: z.string(), folder: FolderState }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** Paste into the page as Edit → Paste does, so the paste event carries every kind of data. */
  "edit:paste": {
    request: z.object({}).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Files copied in Finder, or in Anur, as full paths. */
  "clipboard:read-files": {
    request: z.object({}).strict(),
    response: z.object({ paths: z.array(z.string()) }),
  },
  /** Put the folder's files at these paths on the clipboard, so Finder can paste them. */
  "clipboard:write-files": {
    request: z.object({ paths: z.array(z.string().max(1024)).max(1000) }).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Live agent sessions, the memory the agents use, and the limit (13.3, 13.4). */
  "agent:sessions": {
    request: z.object({}).strict(),
    response: z.object({ live: z.number(), limit: z.number(), memoryMb: z.number().nullable() }),
  },
  "agent:set-session-limit": {
    request: z.object({ limit: z.number().int().min(1).max(50) }).strict(),
    response: z.object({ live: z.number(), limit: z.number(), memoryMb: z.number().nullable() }),
  },
  /** Which switchable Core features are on (group 12). */
  "features:get": {
    request: z.object({}).strict(),
    response: FeatureFlagsSchema,
  },
  /** Turn one switchable Core feature on or off; every window hears it. */
  "features:set": {
    request: z.object({ id: z.enum(["links", "history", "actions"]), on: z.boolean() }).strict(),
    response: FeatureFlagsSchema,
  },
  /** Where updates stand, the running version, and whether they install by themselves. */
  "update:status": {
    request: z.object({}).strict(),
    response: z.object({ state: UpdateState, version: z.string(), auto: z.boolean() }),
  },
  /** Check the feed now, as Check for Updates asks. */
  "update:check": {
    request: z.object({}).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Download the version found, when automatic installs are off. */
  "update:download": {
    request: z.object({}).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Turn automatic installs on or off. */
  "update:set-auto": {
    request: z.object({ auto: z.boolean() }).strict(),
    response: z.object({ auto: z.boolean() }),
  },
  /** Quit and put the downloaded update in place, then open again. */
  "update:restart": {
    request: z.object({}).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** What's new in the version just updated to, once: null when there's nothing to show. */
  "app:whats-new": {
    request: z.object({ seen: z.boolean() }).strict(),
    response: z.object({ version: z.string(), notes: z.array(z.string()) }).nullable(),
  },
  /** Whether to show the first-run tour: not yet seen on this Mac. */
  "tour:status": {
    request: z.object({}).strict(),
    response: z.object({ show: z.boolean() }),
  },
  /** The tour ended, by Done or Skip: don't start it again by itself. */
  "tour:done": {
    request: z.object({}).strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Which app opens .md files from Finder, and whether Anur can be it (an installed Mac app). */
  "opener:status": {
    request: z.object({}).strict(),
    response: z.object({
      can: z.boolean(),
      isAnur: z.boolean(),
      /** The app that opens them now, by name; null when none is set. */
      current: z.string().nullable(),
      dismissed: z.boolean(),
    }),
  },
  /** Make Anur open .md files, or turn the offer down. */
  "opener:act": {
    request: z.object({ action: z.enum(["make", "dismiss"]) }).strict(),
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

  /**
   * The doc's map (task 7): each section's ID, in the order of the page's
   * sections for `text`, and where a person put boxes, by section ID.
   */
  "map:read": {
    request: z.object({ path: z.string().max(4096), text: z.string() }).strict(),
    response: z.object({
      ids: z.array(z.string()),
      positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
    }),
  },
  /** Pen strokes on a doc's map, every device's, less any erased. */
  "map:ink": {
    request: z.object({ path: z.string().max(4096), text: z.string() }).strict(),
    response: z.object({ strokes: z.array(InkStrokeSchema) }),
  },
  /** Strokes drawn here, and strokes erased here. */
  "map:ink-change": {
    request: z
      .object({
        path: z.string().max(4096),
        text: z.string(),
        add: z.array(InkStrokeSchema).max(200),
        erase: z.array(z.string().max(64)).max(2000),
      })
      .strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Boxes a person moved on the map; null puts a box back in the layout. */
  "map:save": {
    request: z
      .object({
        path: z.string().max(4096),
        text: z.string(),
        positions: z
          .record(z.string().max(200), z.object({ x: z.number(), y: z.number() }).nullable())
          .refine((r) => Object.keys(r).length <= 5000),
      })
      .strict(),
    response: z.object({ ok: z.boolean() }),
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
  /** Every thread in the folder, newest first, for Think's Recent list. */
  "thread:recent": {
    request: z.object({}).strict(),
    response: z.object({
      threads: z.array(
        z.object({
          id: z.string(),
          path: z.string(),
          title: z.string(),
          where: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("folder") }),
            z.object({ kind: z.literal("doc") }),
            z.object({ kind: z.literal("section"), path: z.array(z.string()) }),
          ]),
          at: z.string(),
          last: z.string().nullable(),
        }),
      ),
    }),
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
        /** An action (group 15): Anur writes the first message, and the agent plans first. */
        purpose: z.enum(["build", "check"]).optional(),
        /** Branch (10.5): a new thread whose agent knows that thread's chat up to that item. */
        branch: z.object({ thread: z.string().max(200), upTo: z.int().nonnegative() }).optional(),
        /** Files and folders attached in the composer (10.4). */
        files: z.array(z.string().max(4096)).max(50).optional(),
        /** Mode and model picked before the first message, set when its session opens. */
        options: z
          .array(z.object({ id: z.string().max(100), value: z.string().max(200) }))
          .max(10)
          .optional(),
        /** A proposed action this Build runs (Mock 10): the thread that proposed it, and its ID. */
        fromAction: z
          .object({ thread: z.string().max(200), action: z.string().max(200) })
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
        /** Files and folders attached in the composer (10.4). */
        files: z.array(z.string().max(4096)).max(50).optional(),
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
  /** The person picked one of a thread's options; the page has already written its text. */
  "thread:use-option": {
    request: z
      .object({
        thread: z.string().max(200),
        path: z.string().max(4096),
        text: z.string(),
        option: z.string().max(100),
        how: z.enum(["replace", "subsection", "also"]),
      })
      .strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Dig into one option before picking: the thread asks its agent to work it through. */
  "thread:explore-option": {
    request: z
      .object({
        thread: z.string().max(200),
        path: z.string().max(4096),
        text: z.string(),
        option: z.string().max(100),
      })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("started"), thread: ThreadView }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /** A person adds files or links as inputs, to a section or one of its threads (10.1). */
  "inputs:add": {
    request: z
      .object({
        path: z.string().max(4096),
        text: z.string(),
        section: SectionRef,
        thread: z.string().max(200).nullable(),
        files: z.array(z.string().max(4096)).max(100),
        links: z.array(z.string().max(4096)).max(100),
      })
      .strict(),
    response: z.union([z.object({ added: z.number() }), z.object({ error: z.string() })]),
  },
  /** Pick files to add as inputs, in the system's open sheet. */
  "inputs:pick-files": {
    request: z.object({}).strict(),
    response: z.object({ files: z.array(z.string()) }),
  },
  /** The inputs new threads on a section receive: picked up by earlier threads on it or above (4.4). */
  "inputs:list": {
    request: z
      .object({ path: z.string().max(4096), text: z.string(), section: SectionRef })
      .strict(),
    response: z.object({
      inputs: z.array(
        z.object({
          id: z.string(),
          thread: z.string(),
          source: z.string(),
          label: z.string(),
          trust: z.enum(["trusted", "untrusted"]),
          /** Its content stays on the device that read it, out of `.anur/`. */
          local: z.boolean(),
        }),
      ),
    }),
  },
  /**
   * A section's links (8.3): where its links go, which a new thread there
   * reads too, and which sections link to it, across the folder.
   */
  "links:of": {
    request: z
      .object({ path: z.string().max(4096), text: z.string(), section: SectionRef })
      .strict(),
    response: z.object({
      out: z.array(
        z.object({
          /** The doc it points to; null when broken. */
          doc: z.string().nullable(),
          heading: z.string().nullable(),
          /** As written, for a broken one. */
          written: z.string(),
        }),
      ),
      into: z.array(z.object({ doc: z.string(), path: z.array(z.string()) })),
    }),
  },
  /**
   * A section's history (group 5): its versions newest first, and in a git
   * repo the commits that changed it, each with the section's text.
   */
  "history:list": {
    request: z
      .object({ path: z.string().max(4096), text: z.string(), section: SectionRef })
      .strict(),
    response: z.object({
      versions: z.array(
        z.object({
          id: z.string(),
          at: z.string(),
          cause: z.string(),
          summary: z.string(),
          text: z.string(),
          thread: z.string().nullable(),
        }),
      ),
      commits: z.array(
        z.object({
          hash: z.string(),
          at: z.string(),
          author: z.string(),
          subject: z.string(),
          text: z.string(),
        }),
      ),
    }),
  },
  /** A person restored a version of one section: recorded as a "restore" version (5.3). */
  "history:restored": {
    request: z
      .object({
        path: z.string().max(4096),
        text: z.string(),
        section: z.array(z.string()).max(50),
        from: z.string(),
      })
      .strict(),
    response: z.object({}),
  },
  /**
   * Use all (9.4): the page has used the open doc's edits (`open`, its text
   * before and after); main uses the rest in their files and notes it once.
   */
  "thread:use-all": {
    request: z
      .object({
        thread: z.string(),
        open: z
          .object({
            path: z.string(),
            before: z.string(),
            after: z.string(),
            sections: z.array(z.array(z.string())),
          })
          .nullable(),
      })
      .strict(),
    response: z.object({ used: z.number(), kept: z.array(z.string()) }),
  },
  /** One Undo for a Use all (9.5); `open` is the open doc's text now. */
  "thread:undo-all": {
    request: z
      .object({
        thread: z.string(),
        id: z.string(),
        open: z.object({ path: z.string(), text: z.string() }).nullable(),
      })
      .strict(),
    response: z.union([
      z.object({ kind: z.literal("undone"), left: z.array(z.string()) }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /**
   * A person decides on a finding (16.1): keep it (perhaps reworded) or drop
   * it; or adds one, such as from a Check's verdict (16.2), kept at once.
   */
  "finding:decide": {
    request: z
      .object({
        thread: z.string(),
        id: z.string().optional(),
        status: z.enum(["kept", "dropped"]).optional(),
        claim: z.string().max(600).nullable().optional(),
        /** How far a kept one reaches (18.3); kept again with another scope, it moves. */
        scope: z.enum(["section", "doc", "folder", "everywhere"]).optional(),
        add: z.object({ claim: z.string().max(600), source: z.string().nullable() }).optional(),
      })
      .strict(),
    response: z.union([
      z.object({ kind: z.literal("ok") }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /** The findings kept on a section and above it, for Think's list (16.1). */
  "findings:list": {
    request: z
      .object({ path: z.string().max(4096), text: z.string(), section: SectionRef })
      .strict(),
    response: z.object({
      findings: z.array(
        z.object({
          id: z.string(),
          thread: z.string(),
          claim: z.string(),
          source: z.string().nullable(),
          section: z.string(),
          by: z.enum(["source", "person"]).optional(),
          quote: z.string().nullable().optional(),
          who: z.string().nullable().optional(),
          instead: z.string().nullable().optional(),
          until: z.string().nullable().optional(),
          at: z.string().optional(),
          /** Why it needs a look and no longer carries (18.2); null while it holds. */
          lapsed: z.enum(["until", "gone"]).nullable().optional(),
          /** For one only committed: the home it's in, to keep or drop it. */
          home: z.string().optional(),
          /** Another decision here that disagrees with it (18.4), and where that one lives. */
          disputed: z
            .object({
              id: z.string(),
              claim: z.string(),
              who: z.string().nullable(),
              thread: z.string(),
              home: z.string().optional(),
            })
            .nullable()
            .optional(),
        }),
      ),
    }),
  },
  /** A decision that needs a look (18.2): keep it again, keep it for the doc, or drop it. */
  "decision:revise": {
    request: z
      .object({
        thread: z.string().max(200),
        home: z.string().max(4096).optional(),
        id: z.string().max(200),
        action: z.enum(["keep", "doc", "drop"]),
      })
      .strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ok") }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ]),
  },
  /** A person removes an input: it no longer reaches new threads (4.4). */
  "inputs:remove": {
    request: z
      .object({
        path: z.string().max(4096),
        text: z.string(),
        thread: z.string().max(200),
        input: z.string().max(100),
      })
      .strict(),
    response: z.object({ ok: z.boolean() }),
  },
  /** Anur in the person's Claude Code (6.1, 6.2): whether it's added and up to date. */
  "skill:status": {
    request: z.object({}).strict(),
    response: z.object({
      added: z.boolean(),
      dismissed: z.boolean(),
      claude: z.boolean(),
      current: z.boolean(),
    }),
  },
  /** Add, update, remove, or say Not now to the first-launch card. */
  "skill:act": {
    request: z.object({ action: z.enum(["add", "update", "remove", "dismiss"]) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("done") }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** The folder's task reports from Claude Code, newest first (group 21). */
  "tasks:list": {
    request: z.object({}).strict(),
    response: z.object({ reports: z.array(TaskReportView) }),
  },
  /** One task report, for its tab. */
  /** The person's answer on a change that might go against a decision (24.1). */
  "tasks:against": {
    request: z
      .object({
        id: z.string().max(200),
        target: z.string().max(64),
        answer: z.enum(["does", "doesnt"]),
      })
      .strict(),
    response: z.object({ ok: z.boolean() }),
  },
  "tasks:get": {
    request: z.object({ id: z.string().max(200) }).strict(),
    response: z.object({ report: TaskReportView.nullable() }),
  },
  /** The repos in this folder's system, as folder-relative dirs, for the files panel's Repos section. */
  "system:repoDirs": {
    request: z.object({}).strict(),
    response: z.object({
      repos: z.array(z.object({ dir: z.string(), copyOf: z.string().nullable() })),
    }),
  },
  /** The public GitHub repo this folder's threads would be committed to, if any (18.13). */
  "anur:publicRepo": {
    request: z.object({}).strict(),
    response: z.object({ folder: z.string().nullable(), repo: z.string().nullable() }),
  },
  /** Whether to offer Engineering for this window's folder: its code repos, and whether it's on. */
  "engineering:offer": {
    request: z.object({}).strict(),
    response: z.object({ folder: z.string().nullable(), repos: z.number(), on: z.boolean() }),
  },
  /** The `anur` plugin's task hooks in the person's Claude Code (group 21). */
  "taskHooks:status": {
    request: z.object({}).strict(),
    response: z.object({ claude: z.boolean(), added: z.boolean(), current: z.boolean() }),
  },
  /** Add the task hooks to Claude Code, or remove them. */
  "taskHooks:act": {
    request: z.object({ action: z.enum(["add", "remove"]) }).strict(),
    response: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("done") }),
      z.object({ kind: z.literal("failed"), reason: z.string() }),
    ]),
  },
  /** Stop the thread's running turn. */
  /** Which of these threads land their edits as they come: their mode acts without asking. */
  "thread:lands": {
    request: z.object({ threads: z.array(z.string().max(200)).max(50) }).strict(),
    response: z.object({ lands: z.array(z.string()) }),
  },
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
  /** A space starts or finishes opening in this window: its name, or null once it's open. */
  "folder:opening": z.object({ name: z.string().nullable() }),
  /** A note for the person about the space, shown once: as a folder that opened as part of one. */
  "app:notice": z.object({ text: z.string() }),
  /** A plugin's item in the status bar, and its panel; null removes it. */
  "plugin:status": z.object({ plugin: z.string(), status: PluginStatusSchema.nullable() }),
  /** A note from a plugin, shown once. */
  "plugin:notify": z.object({
    plugin: z.string(),
    text: z.string(),
    tone: z.enum(["info", "warn"]),
  }),
  /** Someone's people note changed in the open folder, this Mac's own included: read the list again. */
  "people:changed": z.object({}),
  /** The open doc changed outside Anur: its new text, or that it is gone or no longer readable. */
  "doc:changed": z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("changed"), path: z.string(), text: z.string(), hash: z.string() }),
    z.object({ kind: z.literal("gone"), path: z.string() }),
    z.object({ kind: z.literal("unreadable"), path: z.string(), reason: z.string() }),
  ]),
  /** A menu-bar command for the window's page and tabs. */
  "app:command": z.object({
    command: z.enum([
      "tab-new",
      "tab-close",
      "back",
      "forward",
      "tab-next",
      "tab-prev",
      "tour",
      "updates",
    ]),
  }),
  /** Insert in the menu bar: put this block where the page's cursor is. */
  "editor:insert": z.object({ id: z.enum(INSERT_IDS) }),
  /** A task report arrived in the window's folder (group 21). */
  "tasks:changed": z.object({}),
  /** The folder's repos changed on disk: the system tab reads them again (20.8). */
  "system:changed": z.object({}),
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
  /** An agent in a terminal asked to show a doc (6.7, 6.9): open it, at a section if given. */
  "app:open-doc": z.object({
    path: z.string(),
    section: z.string().nullable(),
    /** A map made from a chat opens as its map. */
    view: z.literal("map").optional(),
  }),
  /** A Core feature was switched on or off, in this window or another. */
  "features:changed": FeatureFlagsSchema,
  /** Where updates stand changed, as when a new version finished downloading. */
  "app:update-state": UpdateState,
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
      /** The agent's plan, when it asks to leave plan mode and carry it out (15.2). */
      plan: z.string().nullable().optional(),
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
  /** Where a file dropped from Finder lives on disk; "" for one that isn't on disk. */
  pathOf(file: File): string;
};
