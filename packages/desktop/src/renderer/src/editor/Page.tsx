import { defaultKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SectionTree } from "@anur/core";
import { useEffect, useRef } from "react";
import { markdownSupport, sectionsOf } from "./sections.ts";
import { pageHighlight, pageTheme } from "./theme.ts";

export type OpenDoc = {
  path: string;
  text: string;
  mode: "editable" | "read-only" | "plain-text";
  note: string | null;
};

/**
 * The page: the doc in CodeMirror. Until autosave arrives (task 2.7) it is
 * read-only, so nothing typed here is lost without saying so. A doc over 5 MB
 * is plain text, without sections.
 */
export function Page({
  doc,
  onSections,
  onView,
}: {
  doc: OpenDoc;
  onSections: (tree: SectionTree | null) => void;
  onView: (view: EditorView | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const fileName = doc.path.split("/").pop() ?? doc.path;
    const markdownDoc = doc.mode !== "plain-text";
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: doc.text,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          keymap.of(defaultKeymap),
          pageTheme,
          ...(markdownDoc ? [markdownSupport(), pageHighlight] : []),
          EditorView.contentAttributes.of({ "aria-label": `Page: ${fileName}` }),
        ],
      }),
    });
    onView(view);
    onSections(markdownDoc ? sectionsOf(view.state, fileName) : null);
    return () => {
      onView(null);
      view.destroy();
    };
  }, [doc, onSections, onView]);

  return <div ref={host} className="page" />;
}
