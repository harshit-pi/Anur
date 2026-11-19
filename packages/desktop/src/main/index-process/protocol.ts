import type { Edge, SourcedSection } from "@anur/core";

/** Main asks the index process for a folder's sections from the plugins switched on. */
export type ToIndex = { type: "sections"; id: number; folder: string; plugins: string[] };

/** What the index process read: sections by source, and edges with what each detector misses. */
export type FolderRead = {
  sources: { id: string; sections: SourcedSection[] }[];
  edges: Edge[];
  misses: { detector: string; misses: string[] }[];
};

/** Each source that applies, with its sections; or why it failed. */
export type FromIndex =
  | { type: "changed"; folder: string }
  | { type: "sections"; id: number; read: FolderRead }
  | { type: "failed"; id: number; reason: string };
