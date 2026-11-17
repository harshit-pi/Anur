import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SectionTree } from "@anur/core";
import { useEffect, useRef, useState } from "react";
import type { Response } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import { CloseIcon } from "../regions/Icons.tsx";
import { Autosaver, type SaveStatus } from "./autosave.ts";
import { formattingKeymap } from "./commands.ts";
import { insertMenu } from "./insert-menu.ts";
import { editLink, linkEditor } from "./link-editor.ts";
import { livePreview } from "./live-preview/live-preview.ts";
import { livePreviewTheme } from "./live-preview/style.ts";
import { editorFilter } from "./editor-filter.ts";
import { diffSpan, mergeOutside, putBack } from "./outside.ts";
import { settled, track } from "./pending-saves.ts";
import { markdownSupport, sectionsOf } from "./sections.ts";
import { pageHighlight, pageTheme } from "./theme.ts";

type KeptEntry = Response<"journal:list">["entries"][number];

/** The first words of kept text, for its banner. */
const firstWords = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
};

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
 * save. A change made outside Anur is folded in at once (2.17), with Undo on
 * a toast, never on the editor's own undo stack.
 */
export function Page({
  doc,
  docs,
  source,
  onSections,
  onView,
  onSaveStatus,
}: {
  doc: OpenDoc;
  /** The folder's docs, for "[[" links. */
  docs: readonly string[];
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
  // Read when a doc opens; a folder's list changing doesn't reopen the doc.
  const docsNow = useRef(docs);
  docsNow.current = docs;
  const previewFor = (src: boolean) => (src ? [] : [livePreview, livePreviewTheme]);
  const [notice, setNotice] = useState<{ text: string; undo: (() => void) | null } | null>(null);
  /** Typing kept from a clash with a change made outside Anur (2.18). */
  const [kept, setKept] = useState<KeptEntry[]>([]);
  const dropKept = (id: string) => {
    void anur.call("journal:drop", { id });
    setKept((k) => k.filter((e) => e.id !== id));
  };
  const putKeptBack = (entry: KeptEntry) => {
    const editor = view.current;
    if (!editor) return;
    const span = putBack(editor.state.doc.toString(), entry);
    if (!span) return;
    editor.dispatch({ changes: span, userEvent: "input.restore", scrollIntoView: true });
    dropKept(entry.id);
  };

  useEffect(() => {
    if (!host.current) return;
    const fileName = doc.path.split("/").pop() ?? doc.path;
    const markdownDoc = doc.mode !== "plain-text";
    const editable = doc.mode === "editable";
    let sectionsTimer: ReturnType<typeof setTimeout> | undefined;
    let saver: Autosaver | null = null;
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    setNotice(null);
    setKept([]);
    if (editable) {
      void anur.call("journal:list", { path: doc.path }).then(({ entries }) => {
        setKept(entries);
      });
    }
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: doc.text,
        extensions: [
          EditorState.readOnly.of(!editable),
          editorFilter,
          EditorView.lineWrapping,
          history(),
          keymap.of([
            ...(markdownDoc && editable ? [{ key: "Mod-k", run: editLink }] : []),
            ...(markdownDoc ? [...formattingKeymap, ...markdownKeymap] : []),
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          pageTheme,
          ...(markdownDoc
            ? [
                markdownSupport(),
                pageHighlight,
                preview.current.of(previewFor(sourceNow.current)),
                ...(editable ? [insertMenu(docsNow.current), linkEditor] : []),
              ]
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
        onConflict: () => {
          void anur.call("doc:open", { path: doc.path }).then((r) => {
            if (r.kind === "doc") fold(r.text, r.hash);
          });
        },
      });
    }

    /** The file is now `text`: fold it in, keeping unsaved typing on other lines. */
    const fold = (text: string, hash: string) => {
      const mine = editor.state.doc.toString();
      if (text === mine) {
        saver?.rebase(hash, text);
        return;
      }
      const { text: merged, kept: clashed } = mergeOutside(saver?.saved ?? mine, mine, text);
      const span = diffSpan(mine, merged);
      if (span) {
        // Not on the undo stack: ⌘Z never takes back someone else's change.
        editor.dispatch({
          changes: span,
          annotations: Transaction.addToHistory.of(false),
          userEvent: "outside",
        });
      }
      saver?.rebase(hash, text);
      if (clashed && editable) {
        // The overlapping typing is kept in the journal and shown in a
        // banner until it is put back or dismissed (2.18).
        void anur.call("journal:keep", { path: doc.path, ...clashed }).then(({ id }) => {
          if (!closed && id) {
            setKept((k) => [
              ...k,
              { ...clashed, id, path: doc.path, at: new Date().toISOString() },
            ]);
          }
        });
        return;
      }
      const undo = editable
        ? () => {
            const back = diffSpan(editor.state.doc.toString(), mine);
            if (back) editor.dispatch({ changes: back, userEvent: "input.restore" });
            setNotice(null);
          }
        : null;
      setNotice({ text: "This doc changed outside Anur; the change is in.", undo });
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        setNotice(null);
      }, 12_000);
    };
    // The page may be rebuilt long after the doc was read, as when the dev
    // server hot-reloads it: read it again, once any save from the page it
    // replaces has landed, and start from what the file has now.
    let closed = false;
    void settled()
      .then(() => anur.call("doc:open", { path: doc.path }))
      .then((r) => {
        if (closed || r.kind !== "doc" || r.hash === doc.hash) return;
        const untouched = editor.state.doc.toString() === doc.text;
        if (untouched && r.text !== doc.text) {
          const span = diffSpan(doc.text, r.text);
          if (span) {
            editor.dispatch({
              changes: span,
              annotations: Transaction.addToHistory.of(false),
              userEvent: "outside",
            });
          }
          saver?.rebase(r.hash, r.text);
        } else if (untouched) saver?.rebase(r.hash, r.text);
        else fold(r.text, r.hash);
      });
    const offOutside = anur.on("doc:changed", (change) => {
      if (change.path !== doc.path) return;
      if (change.kind === "changed") fold(change.text, change.hash);
      else if (change.kind === "gone") {
        saver?.stop(
          "This doc was deleted or moved outside Anur. Its text is still on the page; copy it to keep it.",
        );
      } else saver?.stop(change.reason);
    });
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
      offOutside();
      clearTimeout(sectionsTimer);
      clearTimeout(noticeTimer);
      // Switching docs saves what was typed in this one; the next page waits for it.
      closed = true;
      if (saver) track(saver.flush());
      view.current = null;
      onView(null);
      editor.destroy();
    };
  }, [doc, onSections, onView, onSaveStatus]);

  // ⌘E: switch between live preview and source without reopening the doc.
  useEffect(() => {
    view.current?.dispatch({ effects: preview.current.reconfigure(previewFor(source)) });
  }, [source]);

  return (
    <>
      {kept.map((entry) => {
        const canPutBack = view.current
          ? putBack(view.current.state.doc.toString(), entry) !== null
          : false;
        return (
          <div key={entry.id} className="banner kept" role="status">
            <span>
              This doc changed outside Anur where you were typing; your version of those lines is
              kept: <q className="kept-text">{firstWords(entry.mine)}</q>
            </span>
            <span className="kept-actions">
              <button
                type="button"
                className="toast-action"
                disabled={!canPutBack}
                title={
                  canPutBack ? undefined : "Those lines have changed again; copy yours instead"
                }
                onClick={() => {
                  putKeptBack(entry);
                }}
              >
                Put yours back
              </button>
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  void anur.call("clipboard:write", { text: entry.mine });
                }}
              >
                Copy yours
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Dismiss"
                onClick={() => {
                  dropKept(entry.id);
                }}
              >
                <CloseIcon />
              </button>
            </span>
          </div>
        );
      })}
      <div ref={host} className="page" />
      {notice ? (
        <div className="toast" role="status">
          <span>{notice.text}</span>
          {notice.undo ? (
            <button type="button" className="toast-action" onClick={notice.undo}>
              Undo
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss"
            onClick={() => {
              setNotice(null);
            }}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
    </>
  );
}
