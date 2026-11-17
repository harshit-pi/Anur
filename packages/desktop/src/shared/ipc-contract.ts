import { z } from "zod";
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
  /** Show a native context menu at the pointer; resolves with the chosen item's id, or null. */
  "menu:popup": {
    request: z
      .object({
        items: z
          .array(
            z.union([
              z.object({
                id: z.string().max(64),
                label: z.string().max(120),
                enabled: z.boolean().optional(),
                checked: z.boolean().optional(),
              }),
              z.object({ separator: z.literal(true) }),
            ]),
          )
          .max(40),
      })
      .strict(),
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
  /** Insert in the menu bar: put this block where the page's cursor is. */
  "editor:insert": z.object({ id: z.enum(INSERT_IDS) }),
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
