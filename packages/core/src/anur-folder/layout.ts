import { z } from "zod";
import { FORMAT_VERSION } from "../format.ts";

/**
 * Where everything lives inside `.anur/` (Data Model, "`.anur/` on disk").
 * Paths are relative to `.anur/`, with forward slashes; desktop joins them
 * onto the folder. Every file that changes often has the writing device in
 * its name, so no file ever has two writers.
 *
 *   .anur/
 *     format.json                  one format number
 *     .gitignore, .ignore          each "*"
 *     decisions/<person>.jsonl     committed with the code (23.2)
 *     open/<device>.json
 *     settings/<device>.json
 *     snapshots/<hash>
 *     snapshots/deleted/<device>.jsonl
 *     docs/<doc>/ids/<device>.jsonl
 *     docs/<doc>/layout/<device>.json
 *     docs/<doc>/threads/<thread>/<device>.jsonl
 *     docs/<doc>/inputs/<device>.jsonl
 *     docs/<doc>/previews/<device>/<preview>.json
 *     docs/<doc>/history/<section>/<device>.jsonl
 */
export const ANUR_DIR = ".anur";

/**
 * IDs become file and folder names, and `.anur/` can arrive from another
 * machine through sync or git, so a name must never climb out of its folder.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function segment(kind: string, value: string): string {
  if (!SEGMENT.test(value))
    throw new Error(`unsafe ${kind} in an .anur/ path: ${JSON.stringify(value)}`);
  return value;
}

const seg = segment;

export const anurPaths = {
  format: () => "format.json",
  gitignore: () => ".gitignore",
  /** A person's committed decisions and kept findings (23.2). */
  decisions: (person: string) => `decisions/${seg("person", person)}.jsonl`,
  ignore: () => ".ignore",
  open: (device: string) => `open/${seg("device", device)}.json`,
  settings: (device: string) => `settings/${seg("device", device)}.json`,
  snapshot: (hash: string) => `snapshots/${seg("hash", hash)}`,
  deletedSnapshots: (device: string) => `snapshots/deleted/${seg("device", device)}.jsonl`,
  doc: (doc: string) => `docs/${seg("doc", doc)}`,
  ids: (doc: string, device: string) =>
    `docs/${seg("doc", doc)}/ids/${seg("device", device)}.jsonl`,
  layout: (doc: string, device: string) =>
    `docs/${seg("doc", doc)}/layout/${seg("device", device)}.json`,
  thread: (doc: string, thread: string, device: string) =>
    `docs/${seg("doc", doc)}/threads/${seg("thread", thread)}/${seg("device", device)}.jsonl`,
  inputs: (doc: string, device: string) =>
    `docs/${seg("doc", doc)}/inputs/${seg("device", device)}.jsonl`,
  preview: (doc: string, device: string, preview: string) =>
    `docs/${seg("doc", doc)}/previews/${seg("device", device)}/${seg("preview", preview)}.json`,
  history: (doc: string, section: string, device: string) =>
    `docs/${seg("doc", doc)}/history/${seg("section", section)}/${seg("device", device)}.jsonl`,
} as const;

/** Both ignore files hold "*": git and ripgrep skip the whole folder, and nothing at the folder root changes. */
export const IGNORE_ALL = "*\n";

/**
 * `format.json`. Changes within one format number only add fields, so unknown
 * fields are kept; an app that finds a newer number opens the folder read-only.
 */
export const FormatFile = z.looseObject({ format: z.int().min(1) });
export type FormatFile = z.infer<typeof FormatFile>;

export function formatFileText(): string {
  return `${JSON.stringify({ format: FORMAT_VERSION })}\n`;
}

export type FolderAccess =
  | { mode: "writable"; format: number }
  | { mode: "read-only"; format: number | null; reason: string };

/** What a folder's `format.json` lets this app do. */
export function accessFor(formatJson: string): FolderAccess {
  let parsed: unknown;
  try {
    parsed = JSON.parse(formatJson);
  } catch {
    return {
      mode: "read-only",
      format: null,
      reason: ".anur/format.json is not valid JSON; Anur won't overwrite it.",
    };
  }
  const result = FormatFile.safeParse(parsed);
  if (!result.success) {
    return {
      mode: "read-only",
      format: null,
      reason: ".anur/format.json has no format number; Anur won't overwrite it.",
    };
  }
  const { format } = result.data;
  if (format > FORMAT_VERSION) {
    return {
      mode: "read-only",
      format,
      reason: `This folder uses Anur format ${String(format)}; this app reads up to ${String(FORMAT_VERSION)}. Update Anur to edit it.`,
    };
  }
  return { mode: "writable", format };
}
