import type { Input } from "@lezer/common";
import type { MarkdownConfig } from "@lezer/markdown";
import { styleTags, tags } from "@lezer/highlight";
import { inputOf } from "./frontmatter.ts";

/**
 * Git's merge-conflict markers, read as markers and nothing else: without
 * this, "=======" under a line makes that line a heading, and ">>>>>>>"
 * starts a quote, so the outline and the map would gain sections that
 * aren't there. The middle markers count only in a doc that has an opening
 * "<<<<<<<" line, so a heading underlined with seven "=" still reads as one.
 */

const OPEN = /^<{7}(?:[ \t].*)?$/;
const BASE = /^\|{7}(?:[ \t].*)?$/;
const MIDDLE = /^={7}[ \t]*$/;
const CLOSE = /^>{7}(?:[ \t].*)?$/;

const opened = new WeakMap<Input, boolean>();
function docHasOpen(input: Input): boolean {
  let known = opened.get(input);
  if (known === undefined) {
    known = /^<{7}(?:[ \t]|$)/m.test(input.read(0, input.length));
    opened.set(input, known);
  }
  return known;
}

function isMarker(text: string, input: Input): boolean {
  if (OPEN.test(text)) return true;
  return (BASE.test(text) || MIDDLE.test(text) || CLOSE.test(text)) && docHasOpen(input);
}

export const ConflictMarkers: MarkdownConfig = {
  defineNodes: [{ name: "ConflictMarker", block: true }],
  props: [styleTags({ ConflictMarker: tags.meta })],
  parseBlock: [
    {
      name: "ConflictMarker",
      before: "Blockquote",
      parse(cx, line) {
        if (line.pos !== 0 || !isMarker(line.text, inputOf(cx))) return false;
        cx.addElement(cx.elt("ConflictMarker", cx.lineStart, cx.lineStart + line.text.length));
        cx.nextLine();
        return true;
      },
      endLeaf(cx, line) {
        return line.pos === 0 && isMarker(line.text, inputOf(cx));
      },
    },
  ],
};

/** One conflict: where its lines are, and what each side holds. */
export type Conflict = {
  /** From the start of the "<<<<<<<" line to the end of the ">>>>>>>" line. */
  from: number;
  to: number;
  ours: string;
  theirs: string;
  /** What the markers name, such as "HEAD" and the branch. */
  oursLabel: string;
  theirsLabel: string;
};

/** Every complete conflict in a text, in order. */
export function conflictsIn(text: string): Conflict[] {
  const out: Conflict[] = [];
  const lines = text.split("\n");
  let pos = 0;
  let open: {
    from: number;
    label: string;
    ours: string[];
    base: boolean;
    theirs: string[] | null;
  } | null = null;
  for (const line of lines) {
    const end = pos + line.length;
    const bare = line.replace(/\r$/, "");
    if (OPEN.test(bare)) {
      open = { from: pos, label: bare.slice(7).trim(), ours: [], base: false, theirs: null };
    } else if (open && BASE.test(bare) && open.theirs === null) {
      open.base = true;
    } else if (open && MIDDLE.test(bare) && open.theirs === null) {
      open.theirs = [];
    } else if (open && CLOSE.test(bare) && open.theirs !== null) {
      out.push({
        from: open.from,
        to: end,
        ours: open.ours.join("\n"),
        theirs: open.theirs.join("\n"),
        oursLabel: open.label,
        theirsLabel: bare.slice(7).trim(),
      });
      open = null;
    } else if (open) {
      if (open.theirs !== null) open.theirs.push(line);
      else if (!open.base) open.ours.push(line);
    }
    pos = end + 1;
  }
  return out;
}

/** A conflict's lines replaced by one side, or both, ours first. */
export function resolution(c: Conflict, keep: "ours" | "theirs" | "both"): string {
  if (keep === "ours") return c.ours;
  if (keep === "theirs") return c.theirs;
  return [c.ours, c.theirs].filter((s) => s !== "").join("\n");
}
