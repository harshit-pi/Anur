import { defaultKeymap, redo, undo } from "@codemirror/commands";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { Annotation, EditorState, type Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder, type ViewUpdate } from "@codemirror/view";
import type { SectionNode } from "@anur/core";
import { useEffect, useRef } from "react";
import { pagePath } from "./bases/base-widget.ts";
import { formattingKeymap } from "./commands.ts";
import { livePreview } from "./live-preview/live-preview.ts";
import { livePreviewTheme } from "./live-preview/style.ts";
import { pageUpdates } from "./page-updates.ts";
import { markdownSupport, sectionsOf } from "./sections.ts";
import { pageHighlight } from "./theme.ts";

/**
 * One section's text, editable where Think shows it. It is a second view of
 * the page, not a copy: every keystroke here is an edit to the page, so the
 * page stays the only thing that writes the file, and ⌘Z here undoes on the
 * page. Edits made on the page, or by Apply, show here as they land.
 *
 * It looks like the text Think showed before: no box, no white field.
 */

/** Marks the page's edits that came from here, so they aren't sent back. */
const fromSection = Annotation.define<boolean>();
/** Marks this view's edits that came from the page. */
const fromPage = Annotation.define<boolean>();

type Range = { from: number; to: number };

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
  const lead = text.length - text.trimStart().length;
  const body = text.trim();
  // An empty body sits right after the heading: typing there starts a new paragraph.
  return body ? { from: start + lead, to: start + lead + body.length } : { from: start, to: start };
}

const sectionTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "inherit", fontSize: "inherit" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", fontSize: "inherit", lineHeight: "inherit" },
  // Wrap at the panel's width, however narrow.
  ".cm-content": { padding: "0", caretColor: "var(--blue)", flex: "1 1 0", minWidth: "0" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--blue)" },
  ".cm-placeholder": { color: "var(--graphite)" },
});

export function SectionEditor({
  page,
  docPath,
  section,
  editable,
}: {
  /** The page's own view. */
  page: () => EditorView | null;
  docPath: string;
  section: SectionNode;
  editable: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const range = useRef<Range | null>(null);
  const fileName = docPath.split("/").pop() ?? docPath;
  const sectionNow = useRef(section);
  sectionNow.current = section;

  // Make this view's text match the page's, changing only what differs so the caret stays.
  const sync = () => {
    const main = page();
    const v = view.current;
    const r = range.current;
    if (!main || !v || !r) return;
    const want = main.state.doc.sliceString(r.from, r.to);
    const have = v.state.doc.toString();
    if (want === have) return;
    let a = 0;
    while (a < want.length && a < have.length && want[a] === have[a]) a++;
    let b = 0;
    while (
      b < want.length - a &&
      b < have.length - a &&
      want[want.length - 1 - b] === have[have.length - 1 - b]
    )
      b++;
    v.dispatch({
      changes: { from: a, to: have.length - b, insert: want.slice(a, want.length - b) },
      annotations: fromPage.of(true),
    });
  };

  useEffect(() => {
    const main = page();
    if (!host.current || !main) return;
    range.current = bodyRange(main.state, fileName, sectionNow.current);
    const r = range.current;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: r ? main.state.doc.sliceString(r.from, r.to) : "",
        extensions: [
          EditorState.readOnly.of(!editable || main.state.readOnly),
          EditorView.lineWrapping,
          keymap.of([
            // One history, the page's: ⌘Z here undoes there, and the result shows here.
            { key: "Mod-z", run: () => undo(main) },
            { key: "Mod-Shift-z", run: () => redo(main) },
            { key: "Mod-y", run: () => redo(main) },
            ...formattingKeymap,
            ...markdownKeymap,
            ...defaultKeymap,
          ]),
          markdownSupport(),
          pageHighlight,
          livePreview,
          livePreviewTheme,
          pagePath.of(docPath),
          sectionTheme,
          placeholder("No text yet."),
          EditorView.contentAttributes.of({ "aria-label": "The section's text" }),
        ],
      }),
      // Each edit here is made on the page, at the section's place.
      dispatchTransactions: (trs: readonly Transaction[], self: EditorView) => {
        self.update(trs);
        const at = range.current;
        if (!at) return;
        const mine = trs.filter((tr) => tr.docChanged && !tr.annotation(fromPage));
        if (mine.length === 0) return;
        const first = mine[0];
        if (!first) return;
        const composed = mine.slice(1).reduce((c, tr) => c.compose(tr.changes), first.changes);
        // Text typed into an empty section starts a paragraph under its heading.
        const onHeading =
          at.from === at.to &&
          at.from > 0 &&
          main.state.doc.sliceString(at.from - 1, at.from) !== "\n";
        const lead = onHeading ? "\n\n" : "";
        const changes: { from: number; to?: number; insert: string }[] = lead
          ? [{ from: at.from, insert: lead }]
          : [];
        composed.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          changes.push({ from: at.from + fromA, to: at.from + toA, insert: inserted.toString() });
        });
        main.dispatch({
          changes,
          annotations: fromSection.of(true),
          userEvent: "input.think",
        });
        const start = at.from + lead.length;
        range.current = { from: start, to: start + self.state.doc.length };
      },
    });
    view.current = v;

    // The page changed: follow the section's place, and show its text as it is now.
    const onPage = (u: ViewUpdate) => {
      if (!u.docChanged || !range.current) return;
      if (u.transactions.some((t) => t.annotation(fromSection))) return;
      const was = range.current;
      let from = was.from;
      let to = was.to;
      for (const t of u.transactions) {
        from = t.changes.mapPos(from, -1);
        to = t.changes.mapPos(to, 1);
      }
      range.current = { from, to };
      sync();
    };
    pageUpdates.add(onPage);
    return () => {
      pageUpdates.delete(onPage);
      v.destroy();
      view.current = null;
    };
    // A new editor per section: the parent keys this component by section.
  }, []);

  // The outline caught up with the page: take the section's place from it again.
  useEffect(() => {
    const main = page();
    if (!main) return;
    const r = bodyRange(main.state, fileName, section);
    if (!r) return;
    range.current = r;
    sync();
  }, [section]);

  return <div ref={host} className="think-editor" />;
}

/** Rename a section on the page: only its heading's words change, never its level or marks. */
export function renameSection(
  main: EditorView,
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
