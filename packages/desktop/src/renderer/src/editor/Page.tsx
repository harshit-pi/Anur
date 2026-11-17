import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SectionTree } from "@anur/core";
import { useEffect, useRef } from "react";
import { anur } from "../bridge.ts";
import { Autosaver, type SaveStatus } from "./autosave.ts";
import { formattingKeymap } from "./commands.ts";
import { livePreview } from "./live-preview/live-preview.ts";
import { livePreviewTheme } from "./live-preview/style.ts";
import { markdownSupport, sectionsOf } from "./sections.ts";
import { pageHighlight, pageTheme } from "./theme.ts";

export type OpenDoc = {
  path: string;
  text: string;
  mode: "editable" | "read-only" | "plain-text";
  note: string | null;
  /** The hash of the bytes read; the first save must match it. */
  hash: string;
};

/**
 * The page: the doc in CodeMirror. An editable doc saves itself once typing
 * pauses (task 2.7); a read-only doc, or one over 5 MB shown as plain text,
 * can't be typed into. Markdown renders in place (live preview) unless the
 * person switches to source with ⌘E. Closing the window waits for the last
 * save.
 */
export function Page({
  doc,
  source,
  onSections,
  onView,
  onSaveStatus,
}: {
  doc: OpenDoc;
  source: boolean;
  onSections: (tree: SectionTree | null) => void;
  onView: (view: EditorView | null) => void;
  onSaveStatus: (status: SaveStatus | null, detail: string | null) => void;
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
    const editable = doc.mode === "editable";
    let sectionsTimer: ReturnType<typeof setTimeout> | undefined;
    let saver: Autosaver | null = null;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: doc.text,
        extensions: [
          EditorState.readOnly.of(!editable),
          EditorView.lineWrapping,
          history(),
          keymap.of([
            ...(markdownDoc ? [...formattingKeymap, ...markdownKeymap] : []),
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          pageTheme,
          ...(markdownDoc
            ? [markdownSupport(), pageHighlight, preview.current.of(previewFor(sourceNow.current))]
            : []),
          EditorView.contentAttributes.of({ "aria-label": `Page: ${fileName}` }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            saver?.changed();
            // The outline follows the text, a moment after typing.
            clearTimeout(sectionsTimer);
            sectionsTimer = setTimeout(() => {
              if (markdownDoc) onSections(sectionsOf(editor.state, fileName));
            }, 300);
          }),
        ],
      }),
    });
    if (editable) {
      saver = new Autosaver(doc.hash, {
        save: (text, base) => anur.call("doc:save", { path: doc.path, text, base }),
        text: () => editor.state.doc.toString(),
        composing: () => editor.composing,
        onStatus: onSaveStatus,
      });
    }
    onSaveStatus(editable ? "saved" : null, null);
    // Closing the window with unsaved typing waits for the save, then closes.
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!saver?.dirty || saver.failed) return;
      e.preventDefault();
      void saver.flush().then(() => {
        window.close();
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    view.current = editor;
    onView(editor);
    onSections(markdownDoc ? sectionsOf(editor.state, fileName) : null);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      clearTimeout(sectionsTimer);
      // Switching docs saves what was typed in this one.
      void saver?.flush();
      view.current = null;
      onView(null);
      editor.destroy();
    };
  }, [doc, onSections, onView, onSaveStatus]);

  // ⌘E: switch between live preview and source without reopening the doc.
  useEffect(() => {
    view.current?.dispatch({ effects: preview.current.reconfigure(previewFor(source)) });
  }, [source]);

  return <div ref={host} className="page" />;
}
