import type { SectionTree } from "./tree.ts";

/**
 * The system map as a doc (29.1, 29.2): each box a heading, nested as the
 * map nests them, so a box gets threads, Think and its decisions as a
 * section of a doc does. It's never written to disk. Each section carries
 * its box's own ID in a comment, so threads stay keyed to the system's IDs
 * (`repo:…`, `part:…`), kept through renames as those are, and the IDs are
 * read back from whatever text a window sends, never from a cache.
 */

/** The virtual doc's path; no file in a folder can have it. */
export const SYSTEM_DOC = "Anur system map.anur-system";

const ID = /<!-- id:(\S+) -->/;

type Box = { id: string; path: readonly string[]; text: string; parent: string | null };

/** The doc's text for the map's boxes, depth first in the order given. */
export function systemDocText(boxes: readonly Box[]): string {
  const kids = new Map<string | null, Box[]>();
  const known = new Set(boxes.map((b) => b.id));
  for (const b of boxes) {
    const parent = b.parent && known.has(b.parent) ? b.parent : null;
    kids.set(parent, [...(kids.get(parent) ?? []), b]);
  }
  const out = ["# System", ""];
  const walk = (parent: string | null, depth: number) => {
    for (const b of kids.get(parent) ?? []) {
      // Markdown stops at six levels; deeper boxes sit beside their parent.
      const level = Math.min(depth + 2, 6);
      const name = (b.path.at(-1) ?? b.id).replace(/\s+/g, " ").trim() || b.id;
      out.push(`${"#".repeat(level)} ${name}`, "", `<!-- id:${b.id} -->`);
      if (b.text.trim()) out.push(b.text.trim());
      out.push("");
      walk(b.id, depth + 1);
    }
  };
  walk(null, 0);
  return out.join("\n");
}

/** Each section's box ID, by its index in the tree; null for the title. */
export function systemIdsOf(tree: SectionTree, text: string): (string | null)[] {
  return tree.sections.map((s) => ID.exec(text.slice(s.ownRange.from, s.ownRange.to))?.[1] ?? null);
}

/** The section index of a box, or -1. */
export function systemIndexOf(tree: SectionTree, text: string, id: string): number {
  return systemIdsOf(tree, text).indexOf(id);
}
