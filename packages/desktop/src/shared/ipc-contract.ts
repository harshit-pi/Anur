import { z } from "zod";

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
} as const;

/** Events main sends to a window. */
export const ipcEvents = {
  /** This window's folder changed, as when opened from the menu. */
  "folder:changed": FolderState.nullable(),
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
