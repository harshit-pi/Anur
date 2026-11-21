import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  applyPart,
  conflictsIn,
  merge3,
  rejectHunks,
  rewriteLinks,
  type PreviewPart,
  type SectionTree,
} from "@anur/core";
import { useEffect, useRef, useState } from "react";
import type { Response } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import { TERMINAL_EDIT, UNSAVED_EDIT } from "../../../shared/agents.ts";
import { CloseIcon } from "../regions/Icons.tsx";
import { NoticeBar } from "../regions/NoticeBar.tsx";
import { Autosaver, type SaveStatus } from "./autosave.ts";
import { pagePath } from "./bases/base-widget.ts";
import { pageUpdates } from "./page-updates.ts";
import { landedUndo } from "./landed-undo.ts";
import { markdownEditing } from "./editing.ts";
import type { ClickedLink } from "./link-click.ts";
import { knownDocs, livePreview } from "./live-preview/live-preview.ts";
import { restoreFolds, sectionFolding } from "./fold/section-fold.ts";
import { livePreviewTheme } from "./live-preview/style.ts";
import { editorFilter } from "./editor-filter.ts";
import { changeWithin, diffSpan, mergeOutside, putBack } from "./outside.ts";
import { settled, track } from "./pending-saves.ts";
import { sectionsOf } from "./sections.ts";
import { pageTheme } from "./theme.ts";
import {
  previewActions,
  previewExtension,
  previewState,
  sectionFor,
  sectionKey,
  setPreviews,
  showPreview,
  type PreviewActions,
} from "./previews/preview-widget.ts";
import { holdsWork } from "../quiet.ts";
import { startupMark } from "../startup.ts";

type KeptEntry = Response<"journal:list">["entries"][number];

/** The first words of kept text, for its banner. */
const firstWords = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
};

/** Where a page was: its scroll and its cursor, to come back to (tabs, back and forward). */
export type SavedView = { scrollTop: number; anchor: number; head: number };

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
  onCursor,
  onView,
  onSaveStatus,
  onOpenLink,
  viewKey,
  savedView,
  onLeave,
}: {
  doc: OpenDoc;
  /** The folder's docs, for "[[" links. */
  docs: readonly string[];
  source: boolean;
  onSections: (tree: SectionTree | null) => void;
  /** Where the cursor is, so the Think panel follows the section it's in. */
  onCursor?: (pos: number) => void;
  onView: (view: EditorView | null) => void;
  onSaveStatus: (status: SaveStatus | null, detail: string | null) => void;
  /** Follow a clicked link; returns what to tell the person when it goes nowhere. */
  onOpenLink: (link: ClickedLink, inNewTab: boolean) => string | null;
  /** Which tab and doc this page is, to remember where it was left. */
  viewKey: string;
  /** Where this doc was last left in this tab, to return to. */
  savedView: SavedView | undefined;
  /** The page is closing: where it was, under the key it opened with. */
  onLeave: (key: string, view: SavedView) => void;
}) {
  const viewKeyNow = useRef(viewKey);
  viewKeyNow.current = viewKey;
  // Read when the page opens and closes; changing them doesn't rebuild it.
  const savedViewNow = useRef(savedView);
  savedViewNow.current = savedView;
  const onLeaveNow = useRef(onLeave);
  onLeaveNow.current = onLeave;
  const openLinkNow = useRef(onOpenLink);
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;
  openLinkNow.current = onOpenLink;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const preview = useRef(new Compartment());
  /** The folder's docs, so links to missing docs show faded (8.5). */
  const known = useRef(new Compartment());
  const sourceNow = useRef(source);
  sourceNow.current = source;
  // Read when a doc opens; a folder's list changing doesn't reopen the doc.
  const docsNow = useRef(docs);
  docsNow.current = docs;
  const previewFor = (src: boolean) => (src ? [] : [livePreview, livePreviewTheme]);
  const [notice, setNotice] = useState<{ text: string; undo: (() => void) | null } | null>(null);
  /** Typing kept from a clash with a change made outside Anur (2.18). */
  const [kept, setKept] = useState<KeptEntry[]>([]);
  /** Merge conflicts in the text, for the banner (2.19). */
  const [conflicts, setConflicts] = useState(0);
  /** The conflict count when its bar was closed; a different count shows it again. */
  const [conflictsClosed, setConflictsClosed] = useState(0);
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
    const flash = (text: string, undo: (() => void) | null, ms: number) => {
      setNotice({ text, undo });
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        setNotice(null);
      }, ms);
    };
    const threadsOn = markdownDoc && editable;

    /** The doc's previews from its threads, shown in place (3.8). */
    const loadPreviews = () => {
      if (!threadsOn) return;
      void anur
        .call("preview:list", { path: doc.path, text: editor.state.doc.toString() })
        .then(({ previews }) => {
          if (closed) return;
          editor.dispatch({ effects: setPreviews.of(previews) });
          void useAsTheyLand(previews);
        });
    };
    /** Each edit the setting has already tried, so a clash isn't tried again and again. */
    const autoTried = new Set<string>();
    /**
     * Edits as they land: in a mode that acts without asking (Auto, accept
     * edits), an open doc's page uses each new edit itself, through Apply,
     * and the thread notes it with Undo. Your own kept typing is never
     * applied this way.
     */
    /**
     * One landing at a time (30.42): each apply refreshes the previews and so
     * calls this again; run side by side, two calls applied the same part twice,
     * and a part that adds sections added them twice.
     */
    let landing: Promise<void> = Promise.resolve();
    const useAsTheyLand = (previews: { thread: string; parts: PreviewPart[] }[]) => {
      landing = landing.then(() => landNow(previews)).catch(() => undefined);
      return landing;
    };
    const landNow = async (previews: { thread: string; parts: PreviewPart[] }[]) => {
      if (editor.state.readOnly) return;
      const fresh = previews.flatMap((p) =>
        p.thread === UNSAVED_EDIT
          ? []
          : p.parts
              .filter(
                (part) =>
                  !autoTried.has(`${p.thread}\u0000${sectionKey(part.path)}\u0000${part.proposed}`),
              )
              .map((part) => ({ thread: p.thread, part })),
      );
      if (fresh.length === 0) return;
      const { lands } = await anur.call("thread:lands", {
        threads: [...new Set(fresh.map((f) => f.thread))].filter((t) => t !== TERMINAL_EDIT),
      });
      if (closed) return;
      for (const { thread, part } of fresh.filter((f) => lands.includes(f.thread))) {
        // Tried already, or used or dropped since this list was read: never twice.
        const key = `${thread}\u0000${sectionKey(part.path)}\u0000${part.proposed}`;
        const still = editor.state
          .field(previewState)
          .previews.find((p) => p.thread === thread)
          ?.parts.some(
            (p) => sectionKey(p.path) === sectionKey(part.path) && p.proposed === part.proposed,
          );
        if (autoTried.has(key) || !still) continue;
        autoTried.add(key);
        const ok = await applyPreviewPart(thread, part, false, true);
        if (ok && thread !== TERMINAL_EDIT)
          void anur.call("thread:auto-used", {
            thread,
            path: doc.path,
            text: editor.state.doc.toString(),
            section: part.path,
          });
      }
    };
    /** The thread's preview, with the section's part replaced by `part`, or dropped when null. */
    const withPart = (thread: string, key: string, part: PreviewPart | null) => {
      const all = editor.state.field(previewState).previews;
      const parts = (all.find((p) => p.thread === thread)?.parts ?? []).flatMap((p) =>
        sectionKey(p.path) === key ? (part ? [part] : []) : [p],
      );
      editor.dispatch({
        effects: setPreviews.of(
          all
            .map((p) => (p.thread === thread ? { ...p, parts } : p))
            .filter((p) => p.parts.length > 0),
        ),
      });
      return parts;
    };
    const savePreview = (thread: string, parts: PreviewPart[]) =>
      anur.call("preview:update", {
        path: doc.path,
        text: editor.state.doc.toString(),
        thread,
        parts,
      });

    /**
     * Apply (3.9): the part's changes merged onto the section as it is now,
     * its version written to History first, then one editor transaction, so
     * ⌘Z and the toast's Undo both take it back.
     */
    const applyPreviewPart = async (
      thread: string,
      part: PreviewPart,
      force = false,
      /** Used as it landed, by the setting: a quieter word, and kept as a proposal on a clash. */
      auto = false,
      /** Part of Use all (9.4): no word of its own; Use all says it once. */
      quiet = false,
    ): Promise<boolean> => {
      const conflict = () => {
        if (quiet) return;
        flash(
          auto
            ? `Kept the agent's edit to ${part.path.at(-1) ?? "a section"} as a proposal: that section changed where it did.`
            : "This section changed where the preview did. Ask in the thread again, and it works from the new text.",
          null,
          9000,
        );
      };
      const s = sectionFor(editor.state, part.path);
      if (!s || !part.section) {
        if (!auto && !quiet) flash("That section isn't on the page any more.", null, 6000);
        return false;
      }
      const current = editor.state.sliceDoc(s.subtreeRange.from, s.subtreeRange.to);
      const made = applyPart(current, part, force);
      if (made.kind === "conflict") {
        conflict();
        return false;
      }
      const r = await anur.call("preview:apply", {
        path: doc.path,
        text: editor.state.doc.toString(),
        thread,
        section: part.section,
        applied: made.text,
      });
      if (r.kind === "refused") {
        if (!quiet) flash(r.reason, null, 6000);
        return false;
      }
      // Typing may have landed while History was written: apply onto the section as it is now.
      const s2 = sectionFor(editor.state, part.path);
      if (!s2) return false;
      const now = editor.state.sliceDoc(s2.subtreeRange.from, s2.subtreeRange.to);
      const again = now === current ? made : applyPart(now, part, force);
      if (again.kind === "conflict") {
        conflict();
        return false;
      }
      const before = editor.state.field(previewState).previews.find((p) => p.thread === thread);
      editor.dispatch({
        changes: changeWithin(s2.subtreeRange.from, now, again.text) ?? [],
        userEvent: "apply",
      });
      const after = editor.state.doc;
      const remaining = withPart(thread, sectionKey(part.path), null);
      await savePreview(thread, remaining);
      if (quiet) return true;
      // Back to the text before Apply, keeping any typing since in the section.
      const takeBack = () => {
        const s3 = sectionFor(editor.state, part.path);
        if (!s3) return;
        const nowText = editor.state.sliceDoc(s3.subtreeRange.from, s3.subtreeRange.to);
        const back =
          editor.state.doc === after ? now : merge3(again.text, nowText, now, "ours").text;
        editor.dispatch({
          changes: changeWithin(s3.subtreeRange.from, nowText, back) ?? [],
          userEvent: "apply.undo",
        });
      };
      // Landed on its own: no toast; its row in the thread has the Undo.
      if (auto) {
        landedUndo.set(thread, doc.path, part.path, takeBack);
        return true;
      }
      flash(
        `Applied to ${part.path.at(-1) ?? "the section"}.`,
        () => {
          takeBack();
          if (before) {
            void savePreview(thread, before.parts).then(loadPreviews);
          }
          setNotice(null);
        },
        8000,
      );
      return true;
    };
    const actions: PreviewActions = {
      apply: (thread, part, force) => {
        // Used: its thread opens beside the page, with the choices and actions that came with it.
        void applyPreviewPart(thread, part, force).then((ok) => {
          if (ok) window.dispatchEvent(new CustomEvent("anur:open-thread", { detail: { thread } }));
        });
      },
      refresh: (thread, part) => {
        const section = part.path.at(-1) ?? "the section";
        void anur
          .call("thread:send", {
            thread,
            path: doc.path,
            text: editor.state.doc.toString(),
            message: `I've changed "${section}" since your edit. Make your edit again on the text as it is now.`,
          })
          .then((r) => {
            if (r.kind === "refused") flash(r.reason, null, 6000);
            else window.dispatchEvent(new CustomEvent("anur:open-thread", { detail: { thread } }));
          });
      },
      reject: (thread, part, edits) => {
        const left = withPart(thread, sectionKey(part.path), rejectHunks(part, edits));
        void savePreview(thread, left);
      },
      back: (thread) => {
        window.dispatchEvent(new CustomEvent("anur:open-thread", { detail: { thread } }));
      },
    };
    /** "Preview in doc" from a thread: show its version of each section, at the first. */
    const onShowPreview = (e: Event) => {
      const { thread } = (e as CustomEvent<{ thread: string }>).detail;
      const preview = editor.state.field(previewState).previews.find((p) => p.thread === thread);
      if (!preview) return;
      editor.dispatch({
        effects: preview.parts.map((part) =>
          showPreview.of({ key: sectionKey(part.path), shown: { thread, changes: false } }),
        ),
      });
      const first = preview.parts[0];
      const s = first ? sectionFor(editor.state, first.path) : null;
      if (s)
        editor.dispatch({
          effects: EditorView.scrollIntoView(s.subtreeRange.from, { y: "start", yMargin: 40 }),
        });
    };
    window.addEventListener("anur:show-preview", onShowPreview);
    /**
     * A proposed edit used or set aside from its card in Think: the same
     * Apply as on the page, so the map and Think need no page in view.
     */
    const partOf = (e: Event) => {
      const { thread, path } = (e as CustomEvent<{ thread: string; path: string[] }>).detail;
      const preview = editor.state.field(previewState).previews.find((p) => p.thread === thread);
      const part = preview?.parts.find((x) => sectionKey(x.path) === sectionKey(path));
      return part ? { thread, part } : null;
    };
    const onUsePreview = (e: Event) => {
      const at = partOf(e);
      if (at) void applyPreviewPart(at.thread, at.part);
    };
    const onDropPreview = (e: Event) => {
      const at = partOf(e);
      if (at) void savePreview(at.thread, withPart(at.thread, sectionKey(at.part.path), null));
    };
    // Restore from History (5.3): one version back into its section only, as one change ⌘Z undoes.
    const onRestore = (e: Event) => {
      const {
        path: sectionPath,
        text: version,
        from,
      } = (e as CustomEvent<{ path: string[]; text: string; from: string }>).detail;
      const tree = sectionsOf(editor.state, doc.path.split("/").pop() ?? doc.path);
      const s = tree.sections.find((x) => x.path.join("\u0000") === sectionPath.join("\u0000"));
      if (!s) return;
      const now = editor.state.doc.sliceString(s.subtreeRange.from, s.subtreeRange.to);
      // Keep the section's own trailing break, so the next heading stays where it was.
      const tail = /\s*$/.exec(now)?.[0] ?? "";
      const insert = version.replace(/\s*$/, "") + tail;
      if (insert === now) return;
      editor.dispatch({
        changes: changeWithin(s.subtreeRange.from, now, insert) ?? [],
        userEvent: "restore.version",
        scrollIntoView: true,
      });
      void anur.call("history:restored", {
        path: doc.path,
        text: editor.state.doc.toString(),
        section: sectionPath,
        from,
      });
    };
    // Use all (9.4): this page's edits from the thread, one by one, then the other docs' in main.
    const onUseAll = (e: Event) => {
      const { thread } = (e as CustomEvent<{ thread: string }>).detail;
      void (async () => {
        const before = editor.state.doc.toString();
        const used: string[][] = [];
        // Edits to a section and to its subsections overlap: one landing changes the text
        // another was made against. So go round again over what is left, while any lands;
        // each lands in one click, and only a real clash stays a proposal.
        for (let pass = 0; pass < 8; pass++) {
          const left =
            editor.state.field(previewState).previews.find((p) => p.thread === thread)?.parts ?? [];
          let landed = false;
          for (const part of left)
            if (await applyPreviewPart(thread, part, false, false, true)) {
              used.push(part.path);
              landed = true;
            }
          if (!landed) break;
        }
        const after = editor.state.doc.toString();
        const r = await anur
          .call("thread:use-all", {
            thread,
            open: { path: doc.path, before, after, sections: used },
          })
          .finally(() => {
            window.dispatchEvent(new CustomEvent("anur:use-all-done", { detail: { thread } }));
          });
        const docs = `${String(r.used)} doc${r.used === 1 ? "" : "s"}`;
        flash(
          r.kept.length > 0
            ? `Used this thread's edits in ${docs}. Kept as proposals, as their sections changed: ${r.kept.join(", ")}.`
            : `Used this thread's edits in ${docs}. Undo is in the thread.`,
          null,
          9000,
        );
      })();
    };
    window.addEventListener("anur:use-all", onUseAll);
    window.addEventListener("anur:restore-section", onRestore);
    window.addEventListener("anur:use-preview", onUsePreview);
    window.addEventListener("anur:drop-preview", onDropPreview);
    const offPreviews = anur.on("preview:changed", ({ path }) => {
      if (path === doc.path) loadPreviews();
    });
    // A Revert from a thread (3.11): the page writes it, so ⌘Z takes it back.
    const offReplace = anur.on("doc:replace", ({ path, text }) => {
      if (path !== doc.path || closed) return;
      const span = diffSpan(editor.state.doc.toString(), text);
      if (span) editor.dispatch({ changes: span, userEvent: "restore.revert" });
    });

    // Links that a rename or move broke, written again here so ⌘Z takes them back.
    const offRelink = anur.on("links:rewrite", ({ path, was, moves, before, after }) => {
      if (path !== doc.path || closed || editor.state.readOnly) return;
      const now = editor.state.doc.toString();
      const { text, changed } = rewriteLinks(now, was, path, moves, before, after);
      const span = changed > 0 ? diffSpan(now, text) : null;
      if (span) editor.dispatch({ changes: span, userEvent: "input.links" });
    });

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: doc.text,
        extensions: [
          EditorState.readOnly.of(!editable),
          editorFilter,
          EditorView.lineWrapping,
          history(),
          ...(markdownDoc
            ? markdownEditing({
                editable,
                docs: docsNow.current,
                onOpenLink: (link, inNewTab) => {
                  const problem = openLinkNow.current(link, inNewTab);
                  if (problem) {
                    setNotice({ text: problem, undo: null });
                    clearTimeout(noticeTimer);
                    noticeTimer = setTimeout(() => {
                      setNotice(null);
                    }, 6000);
                  }
                },
                notify: (message) => {
                  flash(message, null, 6000);
                },
              })
            : []),
          keymap.of([...historyKeymap, ...defaultKeymap]),
          pageTheme,
          ...(markdownDoc
            ? [
                sectionFolding(doc.path),
                preview.current.of(previewFor(sourceNow.current)),
                known.current.of(knownDocs.of({ docs: docsNow.current, path: doc.path })),
              ]
            : []),
          pagePath.of(doc.path),
          ...(threadsOn ? [previewExtension, previewActions.of(actions)] : []),
          EditorView.contentAttributes.of({ "aria-label": `Page: ${fileName}` }),
          EditorView.updateListener.of((u) => {
            for (const listen of pageUpdates) listen(u);
            if (u.selectionSet || u.docChanged) onCursorRef.current?.(u.state.selection.main.head);
            if (!u.docChanged) return;
            saver?.changed();
            // The outline follows the text, a moment after typing; at once
            // after an edit from the map, which waits to show the new box.
            const fromMap = u.transactions.some(
              (t) => t.isUserEvent("input.map") || t.isUserEvent("delete.map"),
            );
            clearTimeout(sectionsTimer);
            sectionsTimer = setTimeout(
              () => {
                if (markdownDoc) onSections(sectionsOf(editor.state, fileName));
                setConflicts(conflictsIn(editor.state.doc.toString()).length);
              },
              fromMap ? 0 : 300,
            );
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
        // The overlapping typing becomes a "your unsaved edit" preview on its
        // section, to apply or reject like any other (3.10). Where that can't
        // be kept, as in a read-only folder, it goes to the journal and a
        // banner, as before (2.18).
        const now = editor.state.doc.toString();
        const back = putBack(now, clashed);
        const proposed = back ? now.slice(0, back.from) + back.insert + now.slice(back.to) : null;
        void (
          proposed && threadsOn
            ? anur.call("preview:unsaved", { path: doc.path, text: now, proposed })
            : Promise.resolve({ ok: false })
        ).then(({ ok }) => {
          if (ok) {
            flash(
              "This doc changed outside Anur where you were typing. The file's version is in; yours is kept as a preview on that section.",
              null,
              12_000,
            );
            return;
          }
          keepInJournal();
        });
        return;
      }
      function keepInJournal() {
        if (!clashed) return;
        void anur.call("journal:keep", { path: doc.path, ...clashed }).then(({ id }) => {
          if (!closed && id) {
            setKept((k) => [
              ...k,
              { ...clashed, id, path: doc.path, at: new Date().toISOString() },
            ]);
          }
        });
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

    // The crash journal (2.20): every two seconds, typing not yet saved is
    // written to app support; once it's saved, that copy goes.
    let journaled = false;
    let lastJournaled = "";
    const journalTimer = setInterval(() => {
      if (!saver || closed) return;
      if (saver.dirty) {
        const text = editor.state.doc.toString();
        if (text === lastJournaled) return;
        lastJournaled = text;
        journaled = true;
        void anur.call("recovery:write", { path: doc.path, text, saved: saver.saved });
      } else if (journaled) {
        journaled = false;
        lastJournaled = "";
        void anur.call("recovery:clear", { path: doc.path });
      }
    }, 2000);

    /** Typing journaled before Anur closed without saving it: fold it back in. */
    const restore = (entry: { text: string; saved: string }) => {
      if (closed || !saver) return;
      const now = editor.state.doc.toString();
      if (entry.text === now) {
        void anur.call("recovery:clear", { path: doc.path });
        return;
      }
      // The entry is this page's now: once the restored typing saves, it goes.
      journaled = true;
      const { text: merged, kept: clashed } = mergeOutside(entry.saved, entry.text, now);
      const span = diffSpan(now, merged);
      // On the undo stack: the restored typing is the person's own.
      if (span) editor.dispatch({ changes: span, userEvent: "restore.crash" });
      if (clashed) {
        void anur.call("journal:keep", { path: doc.path, ...clashed }).then(({ id }) => {
          if (!closed && id) {
            setKept((k) => [
              ...k,
              { ...clashed, id, path: doc.path, at: new Date().toISOString() },
            ]);
          }
        });
      }
      if (!span) return;
      setNotice({
        text: "Typing from before Anur closed is back on the page.",
        undo: () => {
          const back = diffSpan(editor.state.doc.toString(), now);
          if (back) editor.dispatch({ changes: back, userEvent: "input.restore" });
          setNotice(null);
        },
      });
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => {
        setNotice(null);
      }, 12_000);
    };

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
      })
      .then(() => (editable ? anur.call("recovery:read", { path: doc.path }) : { entry: null }))
      .then(({ entry }) => {
        if (entry) restore(entry);
      });
    const offOutside = anur.on("doc:changed", (change) => {
      if (change.path !== doc.path) return;
      if (change.kind === "changed") fold(change.text, change.hash);
      else if (change.kind === "gone") {
        // Deleted or moved outside Anur: its tab closes, as in Obsidian.
        window.dispatchEvent(new CustomEvent("anur:doc-gone", { detail: { path: doc.path } }));
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
    // Unsaved typing holds a quiet restart into an update until it's saved.
    const dropHold = holdsWork(() => !!saver?.dirty);
    // Back where this tab left this doc: cursor, then scroll once laid out.
    // The key is the one the page opened with: by the time it closes, the
    // app may already have moved on to another tab.
    const key = viewKeyNow.current;
    const back = savedViewNow.current;
    // Kept as it changes: once the page closes, its scroller reads 0.
    let scrollTop = back?.scrollTop ?? 0;
    const onScroll = () => {
      scrollTop = editor.scrollDOM.scrollTop;
    };
    editor.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    if (back) {
      const len = editor.state.doc.length;
      editor.dispatch({
        selection: { anchor: Math.min(back.anchor, len), head: Math.min(back.head, len) },
      });
      requestAnimationFrame(() => {
        editor.scrollDOM.scrollTop = back.scrollTop;
      });
    }
    view.current = editor;
    if (markdownDoc) restoreFolds(editor, doc.path);
    loadPreviews();
    setConflicts(markdownDoc ? conflictsIn(doc.text).length : 0);
    onView(editor);
    startupMark("page shown");
    onSections(markdownDoc ? sectionsOf(editor.state, fileName) : null);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      dropHold();
      window.removeEventListener("anur:show-preview", onShowPreview);
      window.removeEventListener("anur:use-preview", onUsePreview);
      window.removeEventListener("anur:restore-section", onRestore);
      window.removeEventListener("anur:use-all", onUseAll);
      window.removeEventListener("anur:drop-preview", onDropPreview);
      offPreviews();
      offReplace();
      offRelink();
      offOutside();
      clearTimeout(sectionsTimer);
      clearTimeout(noticeTimer);
      clearInterval(journalTimer);
      // Switching docs saves what was typed in this one; the next page waits for it.
      closed = true;
      landedUndo.dropDoc(doc.path);
      if (saver) {
        const s = saver;
        track(
          s.flush().then(() => {
            if (journaled && !s.dirty) void anur.call("recovery:clear", { path: doc.path });
          }),
        );
      }
      const sel = editor.state.selection.main;
      editor.scrollDOM.removeEventListener("scroll", onScroll);
      onLeaveNow.current(key, {
        scrollTop,
        anchor: sel.anchor,
        head: sel.head,
      });
      view.current = null;
      onView(null);
      editor.destroy();
    };
  }, [doc, onSections, onView, onSaveStatus]);

  // ⌘E: switch between live preview and source without reopening the doc.
  useEffect(() => {
    view.current?.dispatch({ effects: preview.current.reconfigure(previewFor(source)) });
  }, [source]);
  useEffect(() => {
    // A doc added, renamed or deleted can mend or break a link: refade them.
    view.current?.dispatch({
      effects: known.current.reconfigure(knownDocs.of({ docs, path: doc.path })),
    });
  }, [docs, doc.path]);

  /** Put the cursor on the next conflict after it, or the first. */
  const nextConflict = () => {
    const editor = view.current;
    if (!editor) return;
    const all = conflictsIn(editor.state.doc.toString());
    const head = editor.state.selection.main.head;
    const next = all.find((c) => c.from > head) ?? all[0];
    if (!next) return;
    editor.dispatch({ selection: { anchor: next.from }, scrollIntoView: true });
    editor.focus();
  };

  return (
    <>
      {conflicts > 0 && conflicts !== conflictsClosed ? (
        <NoticeBar
          tone="warn"
          onClose={() => {
            setConflictsClosed(conflicts);
          }}
          actions={
            <button type="button" className="toast-action" onClick={nextConflict}>
              {conflicts === 1 ? "Show it" : "Next conflict"}
            </button>
          }
        >
          {conflicts === 1
            ? "This doc has a merge conflict."
            : `This doc has ${String(conflicts)} merge conflicts.`}{" "}
          Keep one side or both at each one. Typing still saves; matching sections waits until it's
          resolved.
        </NoticeBar>
      ) : null}
      {kept.map((entry) => {
        const canPutBack = view.current
          ? putBack(view.current.state.doc.toString(), entry) !== null
          : false;
        return (
          <NoticeBar
            key={entry.id}
            tone="warn"
            onClose={() => {
              dropKept(entry.id);
            }}
            actions={
              <>
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
              </>
            }
          >
            This doc changed outside Anur where you were typing; your version of those lines is
            kept: <q className="kept-text">{firstWords(entry.mine)}</q>
          </NoticeBar>
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
