/**
 * Plugins downloaded from Anur's feed (Plugins and Git mock): standard ones,
 * signed by Anur, installed in a click and kept up to date by themselves.
 * Each is one ES module that exports `activate`; what it shows a person (its
 * settings and buttons) is declared in the feed, so Anur draws it, and the
 * module only does the work. Headless: types and checks, no I/O.
 */
import { z } from "zod";

/** The version of what a downloaded plugin may ask of Anur. */
export const RUNTIME_API = 1;

/** A setting Anur draws for a plugin, per folder. */
export const PluginSetting = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("toggle"),
    key: z.string(),
    label: z.string(),
    detail: z.string().optional(),
    default: z.boolean(),
  }),
  z.object({
    type: z.literal("choice"),
    key: z.string(),
    label: z.string(),
    detail: z.string().optional(),
    choices: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
    default: z.string(),
  }),
  z.object({
    type: z.literal("text"),
    key: z.string(),
    label: z.string(),
    detail: z.string().optional(),
    default: z.string(),
  }),
]);
export type PluginSetting = z.infer<typeof PluginSetting>;

/** One plugin as the feed lists it. */
export const FeedPlugin = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(60),
  what: z.string().min(1).max(300),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  apiVersion: z.number().int().min(1),
  /** "standard": made by Anur. Community plugins come later. */
  kind: z.literal("standard"),
  /** The module's file, next to the feed, and its SHA-256 in hex. */
  file: z.string().regex(/^[\w.-]+\.mjs$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  settings: z.array(PluginSetting).default([]),
  /** Buttons in its settings, by the action they run. */
  actions: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
  /** A way to open a folder from elsewhere, such as "Open from GitHub". */
  openFrom: z.object({ label: z.string() }).nullable().default(null),
});
export type FeedPlugin = z.infer<typeof FeedPlugin>;

export const Feed = z.object({ plugins: z.array(FeedPlugin) });
export type Feed = z.infer<typeof Feed>;

/** Whether `a` is a newer version than `b`. */
export function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** A program's result, as `run` gives it. */
export type RunResult = { code: number; stdout: string; stderr: string };

/** What a downloaded plugin may ask of Anur, for one open folder. */
export type PluginContext = {
  folder: string;
  /** The folder syncs through iCloud Drive. */
  inICloud: boolean;
  /** The person, as teammates see them. */
  person: { name: string; handle: string | null };
  /** This folder's value of a declared setting, typed as the plugin declared it. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a typed read, as Obsidian's loadData
  setting<T extends string | boolean>(key: string): T;
  setSetting(key: string, value: string | boolean): Promise<void>;
  /** Runs a program with the person's login PATH; never throws for a non-zero exit. */
  run(cmd: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<RunResult>;
  /**
   * The plugin's item in the status bar, or null for none: its icon and a few
   * words, and what a click shows: lines about it and buttons for its actions.
   */
  status(s: PluginStatus | null): void;
  /** A note to the person, once. */
  notify(text: string, tone?: "info" | "warn"): void;
  /** Runs `fn` every `ms` until the plugin stops; returns its own stop. */
  every(ms: number, fn: () => void | Promise<void>): () => void;
  /** Runs before Anur quits, given a few seconds. */
  onQuit(fn: () => Promise<void>): void;
  /** The folder's files changed outside Anur, as a pull does: Anur reads them again. */
  filesChanged(): void;
};

/** A plugin's item in the status bar and the panel a click opens. */
export type PluginStatus = {
  text: string;
  /** "ok", "busy" or "warn": how it's drawn. */
  tone?: "ok" | "busy" | "warn";
  /** The panel's lines, such as the repo and when it last synced. */
  lines?: { label: string; value: string; href?: string }[];
  /** The panel's buttons, by the action each runs. */
  actions?: { id: string; label: string }[];
};

/** A folder another place offers, as Open from GitHub lists them. */
export type OpenFromItem = { id: string; label: string; detail: string };

/** What a plugin's `activate` returns. */
export type PluginInstance = {
  actions?: Record<string, () => Promise<string | undefined>>;
  /** Called when one of its settings changed in this folder. */
  settingsChanged?: () => void;
  stop?: () => void | Promise<void>;
};

/** What a plugin offering `openFrom` exports beside `activate`. */
export type OpenFrom = {
  list(run: PluginContext["run"]): Promise<OpenFromItem[]>;
  /** Clones the item into `dest`; resolves with an error to show, or null. */
  open(run: PluginContext["run"], id: string, dest: string): Promise<string | null>;
};
