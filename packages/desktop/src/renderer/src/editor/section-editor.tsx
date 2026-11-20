import { defaultKeymap, redo, undo } from "@codemirror/commands";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { insertNewlineContinueNumbering } from "./list-numbering.ts";
import { Annotation, EditorState, type Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder, type ViewUpdate } from "@codemirror/view";
import type { SectionNode } from "@anur/core";
import { useEffect, useRef } from "react";
import { pagePath } from "./bases/base-widget.ts";
import { formattingKeymap } from "./commands.ts";
import { knownDocs, livePreview } from "./live-preview/live-preview.ts";
import { livePreviewTheme } from "./live-preview/style.ts";
import { pageUpdates } from "./page-updates.ts";
import { markdownSupport } from "./sections.ts";
import { bodyRange, type Range } from "./section-range.ts";
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
    // The page's view of the folder's docs, so a broken link is faded here too (8.5).
    const known = main.state.facet(knownDocs);
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
            { key: "Enter", run: insertNewlineContinueNumbering },
            ...formattingKeymap,
            ...markdownKeymap,
            ...defaultKeymap,
          ]),
          markdownSupport(),
          pageHighlight,
          livePreview,
          livePreviewTheme,
          ...(known ? [knownDocs.of(known)] : []),
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
    // Its place is found once, here, then followed through every edit; it is
    // never taken again from the outline, which would trim away a space or a
    // new line just typed at the end.
  }, []);

  return <div ref={host} className="think-editor" />;
}
