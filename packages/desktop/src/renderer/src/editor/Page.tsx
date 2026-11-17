import { defaultKeymap } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SectionTree } from "@anur/core";
import { useEffect, useRef } from "react";
import { livePreview } from "./live-preview/live-preview.ts";
import { livePreviewTheme } from "./live-preview/style.ts";
import { markdownSupport, sectionsOf } from "./sections.ts";
import { pageHighlight, pageTheme } from "./theme.ts";

export type OpenDoc = {
  path: string;
  text: string;
  mode: "editable" | "read-only" | "plain-text";
  note: string | null;
};

/**
 * The page: the doc in CodeMirror. Until autosave arrives (task 2.8) it is
 * read-only, so nothing typed here is lost without saying so. A doc over 5 MB
 * is plain text, without sections. Markdown renders in place (live preview)
 * unless the person switches to source with ⌘E.
 */
export function Page({
  doc,
  source,
  onSections,
  onView,
}: {
  doc: OpenDoc;
  source: boolean;
  onSections: (tree: SectionTree | null) => void;
  onView: (view: EditorView | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const preview = useRef(new Compartment());
  const sourceNow = useRef(source);
  sourceNow.current = source;
  const previewFor = (src: boolean) => (src ? [] : [livePreview, livePreviewTheme]);

  useEffect(() => {
    if (!host.current) return;
    const fileName = doc.path.split("/").pop() ?? doc.path;
    const markdownDoc = doc.mode !== "plain-text";
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: doc.text,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.lineWrapping,
          keymap.of(defaultKeymap),
          pageTheme,
          ...(markdownDoc
            ? [markdownSupport(), pageHighlight, preview.current.of(previewFor(sourceNow.current))]
            : []),
          EditorView.contentAttributes.of({ "aria-label": `Page: ${fileName}` }),
        ],
      }),
    });
    view.current = editor;
    onView(editor);
    onSections(markdownDoc ? sectionsOf(editor.state, fileName) : null);
    return () => {
      view.current = null;
      onView(null);
      editor.destroy();
    };
  }, [doc, onSections, onView]);

  // ⌘E: switch between live preview and source without reopening the doc.
  useEffect(() => {
    view.current?.dispatch({ effects: preview.current.reconfigure(previewFor(source)) });
  }, [source]);

  return <div ref={host} className="page" />;
}
