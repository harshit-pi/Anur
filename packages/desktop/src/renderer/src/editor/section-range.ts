import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { SectionNode } from "@anur/core";
import { sectionsOf } from "./sections.ts";

/** Where a section's text sits in the page, for Think's section editor. */
export type Range = { from: number; to: number };

/** The section as the page has it now: by heading path, then which namesake it is. */
export function sectionNow(state: EditorState, fileName: string, section: SectionNode) {
  const tree = sectionsOf(state, fileName);
  const same = (s: SectionNode) =>
    s.path.length === section.path.length && s.path.every((p, i) => p === section.path[i]);
  return (
    tree.sections.find((x) => same(x) && x.ordinal === section.ordinal) ??
    tree.sections.find(same) ??
    null
  );
}

/** Where a section's own text is in the page now, without its heading or the blank lines around it. */
export function bodyRange(
  state: EditorState,
  fileName: string,
  section: SectionNode,
): Range | null {
  const s = sectionNow(state, fileName, section);
  if (!s) return null;
  const start = s.headingRange ? s.headingRange.to : s.ownRange.from;
  const text = state.doc.sliceString(start, s.ownRange.to);
  // Only the blank lines around the text are left out: spaces typed at its
  // end are part of it, or Backspace would miss them.
  const lead = /^(?:[ \t]*\n)*/.exec(text)?.[0].length ?? 0;
  const trail = /(?:\n[ \t]*)*$/.exec(text.slice(lead))?.[0].length ?? 0;
  const body = text.slice(lead, text.length - trail);
  // An empty body sits right after the heading: typing there starts a new paragraph.
  return body ? { from: start + lead, to: start + lead + body.length } : { from: start, to: start };
}

/** Rename a section on the page: only its heading's words change, never its level or marks. */
export function renameSection(
  main: { state: EditorState; dispatch: (spec: TransactionSpec) => void },
  fileName: string,
  section: SectionNode,
  name: string,
): boolean {
  const s = sectionNow(main.state, fileName, section);
  const h = s?.headingRange;
  if (!h) return false;
  const line = main.state.doc.sliceString(h.from, h.to);
  const atx = /^(\s{0,3}#{1,6}[ \t]+)(.*?)([ \t]+#+[ \t]*)?$/.exec(line.split("\n")[0] ?? "");
  const [from, to] = atx
    ? [h.from + (atx[1]?.length ?? 0), h.from + (atx[1]?.length ?? 0) + (atx[2]?.length ?? 0)]
    : // A setext heading: its words are its first line.
      [h.from, h.from + (line.split("\n")[0] ?? "").trimEnd().length];
  if (main.state.doc.sliceString(from, to) === name) return false;
  main.dispatch({ changes: { from, to, insert: name }, userEvent: "input.rename" });
  return true;
}
