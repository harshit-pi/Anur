import type { SourcedSection } from "@anur/core";

/** Main asks the index process for a folder's sections from the plugins switched on. */
export type ToIndex = { type: "sections"; id: number; folder: string; plugins: string[] };

/** Each source that applies, with its sections; or why it failed. */
export type FromIndex =
  | { type: "sections"; id: number; sources: { id: string; sections: SourcedSection[] }[] }
  | { type: "failed"; id: number; reason: string };
