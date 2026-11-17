import { EditorView } from "@codemirror/view";
import type { SectionTree } from "@anur/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { settled } from "./editor/pending-saves.ts";
import { freeName } from "./layout/file-tree.ts";
import type { FileActions } from "./regions/FileTree.tsx";
import type { FolderState } from "../../shared/ipc-contract.ts";
import type { SaveStatus } from "./editor/autosave.ts";
import { Page, type OpenDoc, type SavedView } from "./editor/Page.tsx";
import { insertById } from "./editor/insert-menu.ts";
import { Resizer } from "./layout/Resizer.tsx";
import { headingKey, resolveHref, resolveWiki } from "./layout/links.ts";
import { DOC_ITEM, folderMenu, sectionAt, wikiLinkTo } from "./layout/path-row.ts";
import type { ClickedLink } from "./editor/link-click.ts";
import {
  back,
  canGoBack,
  canGoForward,
  close,
  currentDoc,
  cycle,
  forward,
  listItems,
  loadTabs,
  newTab,
  noTabs,
  open as openInTab,
  prune,
  renamePaths,
  saveTabs,
  select,
  type Tabs,
} from "./layout/tabs.ts";
import {
  isDownloaded,
  markDownloaded,
  noneDownloaded,
  withDownloaded,
} from "./layout/downloaded.ts";
import { loadOpen, loadWidths, saveOpen, saveWidths, type Side } from "./layout/panel-widths.ts";
import { anur } from "./bridge.ts";
import { CommandPalette } from "./regions/CommandPalette.tsx";
import { Think } from "./regions/Think.tsx";
import { Settings, type SettingsSection } from "./regions/Settings.tsx";
import { newDocPath } from "./layout/new-doc.ts";
import { MergeDialog } from "./regions/MergeDialog.tsx";
import { Center, LeftSidebar, Ribbon, RightSidebar, StatusBar } from "./regions/Regions.tsx";
import { TabBar } from "./regions/TabBar.tsx";

export function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** The settings section shown, or null when settings are closed (2.25). */
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const closeSettings = useCallback(() => {
    setSettings(null);
  }, []);
  const [version, setVersion] = useState<string | null>(null);
  const [folder, setFolder] = useState<FolderState | null>(null);
  const [tabs, setTabs] = useState<Tabs>(noTabs);
  /** Bumped when a tab is pressed, so the sidebar reveals its doc even if it was already in focus. */
  const [reveal, setReveal] = useState(0);
  /** The doc in the active tab. */
  const selected = currentDoc(tabs);
  const [merging, setMerging] = useState<string | null>(null);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [sections, setSections] = useState<SectionTree | null>(null);
  /** The section the cursor is in, by index: what the Think panel is about. */
  const [cursorSection, setCursorSection] = useState(0);
  const sectionsNow = useRef(sections);
  sectionsNow.current = sections;
  const onCursor = useCallback((pos: number) => {
    const tree = sectionsNow.current;
    const at = tree ? (sectionAt(tree, pos)?.index ?? 0) : 0;
    setCursorSection((i) => (i === at ? i : at));
  }, []);
  const [source, setSource] = useState(false);
  const [save, setSave] = useState<{ status: SaveStatus | null; detail: string | null }>({
    status: null,
    detail: null,
  });
  const onSaveStatus = useCallback((status: SaveStatus | null, detail: string | null) => {
    setSave({ status, detail });
  }, []);
  const [downloaded, setDownloaded] = useState(noneDownloaded);
  // Read inside the open effect without making it a dependency: marking a doc
  // downloaded must not close and reopen the doc being read.
  const downloadedNow = useRef(downloaded);
  downloadedNow.current = downloaded;
  /** The folder as shown: docs opened since it was listed aren't cloud-only. */
  const shown = useMemo(
    () => (folder ? withDownloaded(folder, downloaded) : null),
    [folder, downloaded],
  );
  const view = useRef<EditorView | null>(null);
  /** The page's text as it stands, for threads: unsaved typing included. */
  const docText = useCallback(() => view.current?.state.doc.toString() ?? "", []);
  const onView = useCallback((v: EditorView | null) => {
    view.current = v;
    // Check runs only: a probe can set a selection exactly as a mouse would.
    if (window.location.hash === "#check") {
      (window as unknown as { anurView?: EditorView | null }).anurView = v;
    }
  }, []);

  // Open the picked doc; an offloaded one downloads from iCloud first.
  useEffect(() => {
    setDoc(null);
    setSections(null);
    setDocError(null);
    if (!selected) {
      setOpening(null);
      return;
    }
    let current = true;
    const inCloud =
      folder?.offloaded.includes(selected) &&
      !isDownloaded(downloadedNow.current, folder.path, selected);
    setOpening(inCloud ? "Downloading from iCloud…" : "Opening…");
    void anur.call("doc:open", { path: selected }).then((r) => {
      if (!current) return;
      setOpening(null);
      if (r.kind === "doc") {
        setDoc(r);
        if (folder?.offloaded.includes(selected)) {
          const path = folder.path;
          setDownloaded((d) => markDownloaded(d, path, selected));
        }
      } else setDocError(r.reason);
    });
    return () => {
      current = false;
    };
  }, [selected, folder]);

  // Each folder has its own tabs, remembered on this device.
  const folderPath = folder?.path ?? null;
  const folderDocs = folder?.docs;
  useEffect(() => {
    setTabs(
      folderPath && folderDocs ? loadTabs(window.localStorage, folderPath, folderDocs) : noTabs,
    );
    // Only when another folder opens: a changed list keeps the tabs as they are.
  }, [folderPath]);
  useEffect(() => {
    if (folderPath) saveTabs(window.localStorage, folderPath, tabs);
  }, [tabs, folderPath]);
  const openDoc = useCallback((path: string, inNewTab: boolean) => {
    setTabs((t) => openInTab(t, path, inNewTab));
  }, []);
  /** Where each tab left each doc it showed, kept while the app runs. */
  const savedViews = useRef(new Map<string, SavedView>());
  const viewKey = `${tabs.active ?? ""}|${doc?.path ?? ""}`;
  const leaveView = useCallback((key: string, saved: SavedView) => {
    savedViews.current.set(key, saved);
  }, []);

  /** A new doc beside the open one, named as typed or Untitled, opened at once. */
  const newDoc = useCallback(
    (name: string) => {
      if (!folder || folder.mode !== "writable") return;
      const path = newDocPath(folder.docs, selected, name);
      void anur.call("doc:create", { path }).then((r) => {
        if (r.kind === "created") {
          setFolder(r.folder);
          openDoc(r.path, false);
        } else console.warn("Anur couldn't make the doc:", r.reason);
      });
    },
    [folder, selected, openDoc],
  );
  /** While true the page is put away, so a doc being moved saves first and isn't written behind. */
  const [holding, setHolding] = useState(false);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tell = useCallback((reason: string) => {
    setFileNotice(reason);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => {
      setFileNotice(null);
    }, 6000);
  }, []);
  /** Run a change to the files; if it touches the open doc, its typing is saved first. */
  const touching = useCallback(
    async <T,>(paths: readonly string[], run: () => Promise<T>): Promise<T> => {
      const open = selected;
      const hits = open !== null && paths.some((p) => open === p || open.startsWith(`${p}/`));
      if (hits) {
        flushSync(() => {
          setHolding(true);
        });
        await settled();
      }
      try {
        return await run();
      } finally {
        if (hits) setHolding(false);
      }
    },
    [selected],
  );
  const fileActions = useMemo((): FileActions | undefined => {
    if (!folder || folder.mode !== "writable") return undefined;
    return {
      newDoc: async (dir) => {
        const path = freeName(folder.docs, dir, "Untitled", ".md");
        const r = await anur.call("doc:create", { path });
        if (r.kind === "failed") {
          tell(r.reason);
          return null;
        }
        setFolder(r.folder);
        openDoc(r.path, false);
        return r.path;
      },
      newFolder: async (dir) => {
        const path = freeName([...folder.folders, ...folder.docs], dir, "New folder");
        const r = await anur.call("folder:create", { path });
        if (r.kind === "failed") {
          tell(r.reason);
          return null;
        }
        setFolder(r.folder);
        return r.path;
      },
      move: (from, to) =>
        touching([from], async () => {
          const r = await anur.call("file:move", { from, to });
          if (r.kind === "failed") {
            tell(r.reason);
            return false;
          }
          setTabs((t) => renamePaths(t, r.docs));
          setFolder(r.folder);
          return true;
        }),
      duplicate: async (path) => {
        const r = await anur.call("file:duplicate", { path });
        if (r.kind === "failed") tell(r.reason);
        else setFolder(r.folder);
      },
      trash: async (path, isFolder, docs) => {
        const what = path.split("/").pop() ?? path;
        // A doc goes quietly, since Finder can put it back; a folder of docs asks first.
        if (
          isFolder &&
          docs > 0 &&
          !window.confirm(
            `Move “${what}” and the ${String(docs)} ${docs === 1 ? "doc" : "docs"} in it to the Trash?`,
          )
        )
          return;
        await touching([path], async () => {
          const r = await anur.call("file:trash", { path });
          if (r.kind === "failed") {
            tell(r.reason);
            return;
          }
          setTabs((t) => prune(t, r.folder.docs));
          setFolder(r.folder);
        });
      },
    };
  }, [folder, openDoc, tell, touching]);
  const newDocNow = useRef(newDoc);
  newDocNow.current = newDoc;
  /** A line search found, selected once its doc is open on the page. */
  const [pendingLine, setPendingLine] = useState<{
    path: string;
    line: number;
    column: number;
    length: number;
  } | null>(null);
  const openLine = useCallback(
    (path: string, line: number, column: number, length: number) => {
      setPendingLine({ path, line, column, length });
      openDoc(path, false);
    },
    [openDoc],
  );
  /** A heading a link asked for, scrolled to once its doc's sections are in. */
  const [pendingHeading, setPendingHeading] = useState<{ path: string; heading: string } | null>(
    null,
  );
  /** Follow a link clicked on the page; returns what to say when it goes nowhere. */
  const openLink = useCallback(
    (link: ClickedLink, inNewTab: boolean): string | null => {
      if (!folder || !selected) return null;
      const target =
        link.kind === "wiki"
          ? resolveWiki(folder.docs, selected, link.target, link.heading)
          : resolveHref(folder.docs, selected, link.href);
      if (target.kind === "web") {
        void anur.call("link:open-external", { url: target.url });
        return null;
      }
      if (target.kind === "missing") return `No doc called “${target.name}” in this folder.`;
      if (target.heading) setPendingHeading({ path: target.path, heading: target.heading });
      if (target.path !== selected || inNewTab) openDoc(target.path, inNewTab);
      return null;
    },
    [folder, selected, openDoc],
  );

  /** A breadcrumb: what the folder it names holds; picking a doc opens it here. */
  const showFolder = useCallback(
    (inside: string) => {
      if (!folder) return;
      void anur
        .call("menu:popup", { items: folderMenu(folder.docs, inside, selected) })
        .then(({ id }) => {
          if (id?.startsWith(DOC_ITEM)) openDoc(id.slice(DOC_ITEM.length), false);
        });
    },
    [folder, selected, openDoc],
  );
  /** A link to the section at the cursor, as Obsidian writes it, copied. */
  const copySectionLink = useCallback(async (): Promise<string | null> => {
    if (!folder || !selected) return null;
    const v = view.current;
    const section = sections && v ? sectionAt(sections, v.state.selection.main.head) : null;
    const isTitle = !section || section === sections?.sections[0];
    const link = wikiLinkTo(folder.docs, selected, isTitle ? null : (section.path.at(-1) ?? null));
    const { ok } = await anur.call("clipboard:write", { text: link });
    return ok ? link : null;
  }, [folder, selected, sections]);
  const showMore = useCallback(() => {
    if (!folder || !selected) return;
    void anur
      .call("menu:popup", {
        items: [
          { id: "finder", label: "Reveal in Finder" },
          { id: "default-app", label: "Open in Default App" },
          { separator: true },
          { id: "copy-path", label: "Copy Path" },
          { id: "copy-doc-link", label: "Copy Link to Doc" },
          { separator: true },
          { id: "source", label: "Show Source (⌘E)", checked: source },
        ],
      })
      .then(({ id }) => {
        if (id === "finder" || id === "default-app") {
          void anur.call("doc:reveal", { path: selected, how: id });
        } else if (id === "copy-path") {
          void anur.call("clipboard:write", { text: `${folder.path}/${selected}` });
        } else if (id === "copy-doc-link") {
          void anur.call("clipboard:write", { text: wikiLinkTo(folder.docs, selected, null) });
        } else if (id === "source") setSource((s) => !s);
      });
  }, [folder, selected, source]);
  const listTabs = useCallback(() => {
    void anur
      .call("menu:popup", {
        items: listItems(tabs),
      })
      .then(({ id }) => {
        if (id) setTabs((t) => select(t, id));
      });
  }, [tabs]);

  const jumpTo = useCallback(
    (index: number) => {
      const target = sections?.sections[index]?.headingRange;
      const v = view.current;
      if (!target || !v) return;
      // The heading lands at the top of the page, as in Obsidian, rather than
      // wherever the least scrolling would leave it.
      v.dispatch({
        selection: { anchor: target.from },
        effects: EditorView.scrollIntoView(target.from, { y: "start", yMargin: 24 }),
      });
      v.focus();
    },
    [sections],
  );
  // A link's heading: once its doc is open and parsed, scroll to it.
  useEffect(() => {
    // Wait until the page shows that doc: until then, the sections are the old doc's.
    if (!pendingHeading || doc?.path !== pendingHeading.path || !sections) return;
    const want = headingKey(pendingHeading.heading);
    const index = sections.sections.findIndex((s) => headingKey(s.path.at(-1) ?? "") === want);
    setPendingHeading(null);
    if (index >= 0) jumpTo(index);
  }, [pendingHeading, doc, sections, jumpTo]);
  // A search result's line: once its doc is on the page, select the match there.
  useEffect(() => {
    if (!pendingLine || doc?.path !== pendingLine.path || !sections) return;
    const v = view.current;
    setPendingLine(null);
    if (!v || pendingLine.line > v.state.doc.lines) return;
    const line = v.state.doc.line(pendingLine.line);
    const from = Math.min(line.to, line.from + pendingLine.column);
    const to = Math.min(line.to, from + pendingLine.length);
    v.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    v.focus();
  }, [pendingLine, doc, sections]);
  const [widths, setWidths] = useState(() => loadWidths(window.localStorage));
  const [open, setOpen] = useState(() => loadOpen(window.localStorage));
  const toggle = useCallback((side: Side) => {
    setOpen((o) => {
      const next = { ...o, [side]: !o[side] };
      saveOpen(window.localStorage, next);
      return next;
    });
  }, []);
  /**
   * A thread to open in Think, as "Keep discussing" on a preview asks. Held
   * here, so it reaches Think however the panel was showing when it came.
   */
  const [threadRequest, setThreadRequest] = useState<{ thread: string; n: number } | null>(null);
  useEffect(() => {
    const onThread = (e: Event) => {
      const { thread } = (e as CustomEvent<{ thread: string }>).detail;
      setThreadRequest((r) => ({ thread, n: (r?.n ?? 0) + 1 }));
      setOpen((o) => {
        if (o.right) return o;
        const next = { ...o, right: true };
        saveOpen(window.localStorage, next);
        return next;
      });
    };
    window.addEventListener("anur:open-thread", onThread);
    return () => {
      window.removeEventListener("anur:open-thread", onThread);
    };
  }, []);
  const setWidth = (side: Side) => (width: number) => {
    setWidths((w) => {
      const next = { ...w, [side]: width };
      saveWidths(window.localStorage, next);
      return next;
    });
  };

  useEffect(() => {
    void anur.call("app:info", {}).then((info) => {
      setVersion(info.version);
    });
    void anur.call("folder:current", {}).then(setFolder);
    const offInsert = anur.on("editor:insert", ({ id }) => {
      const v = view.current;
      if (!v || v.state.readOnly) return;
      v.focus();
      insertById(v, id);
    });
    const offFolder = anur.on("folder:changed", (f) => {
      setFolder(f);
    });
    const offCommand = anur.on("app:command", ({ command }) => {
      if (command === "tab-new") setTabs((t) => newTab(t));
      else if (command === "tab-close") setTabs((t) => (t.active ? close(t, t.active) : t));
      else if (command === "back") setTabs(back);
      else if (command === "forward") setTabs(forward);
      else setTabs((t) => cycle(t, command === "tab-next" ? 1 : -1));
    });
    return () => {
      offInsert();
      offFolder();
      offCommand();
    };
  }, []);

  const openFolder = useCallback(() => {
    void anur.call("folder:choose", {}).then((r) => {
      if (r.kind === "opened") setFolder(r.folder);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The page takes ⌘K first when text is selected, to make a link.
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettings((s) => (s ? null : "general"));
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newDocNow.current("");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      // ⌘\ hides or shows the files panel, ⌥⌘\ the section panel.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === "Backslash") {
        e.preventDefault();
        toggle(e.altKey ? "right" : "left");
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setSource((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [toggle]);

  return (
    <div
      className="shell"
      style={{
        gridTemplateColumns: `48px ${String(open.left ? widths.left : 0)}px minmax(0, 1fr) ${String(open.right ? widths.right : 0)}px`,
      }}
    >
      <TabBar
        open={open}
        onToggle={toggle}
        tabs={tabs}
        onChange={setTabs}
        onSelectTab={(id) => {
          setTabs((t) => select(t, id));
          setReveal((n) => n + 1);
        }}
        onNewTab={() => {
          setTabs((t) => newTab(t));
        }}
        onListTabs={listTabs}
      />
      <Ribbon
        filesOpen={open.left}
        onFiles={() => {
          toggle("left");
        }}
        searchOpen={paletteOpen}
        onSearch={() => {
          setPaletteOpen((o) => !o);
        }}
        onSettings={() => {
          setSettings("general");
        }}
        onPlugins={() => {
          setSettings("core");
        }}
      />
      <LeftSidebar
        folder={shown}
        selected={selected}
        onSelect={openDoc}
        hidden={!open.left}
        reveal={reveal}
        actions={fileActions}
        notice={fileNotice}
      />
      <Center
        folder={shown}
        selected={selected}
        page={
          // Only the doc the tab shows: after a rename the old one mustn't mount for a moment.
          doc && !holding && doc.path === selected ? (
            <Page
              doc={doc}
              docs={folder?.docs ?? []}
              source={source}
              onSections={setSections}
              onCursor={onCursor}
              onView={onView}
              onSaveStatus={onSaveStatus}
              onOpenLink={openLink}
              viewKey={viewKey}
              savedView={savedViews.current.get(viewKey)}
              onLeave={leaveView}
            />
          ) : null
        }
        opening={opening}
        docNote={doc?.note ?? null}
        docError={docError ?? save.detail}
        onOpenFolder={openFolder}
        onMerge={setMerging}
        onCrumb={showFolder}
        onCopyLink={copySectionLink}
        onMore={showMore}
        onBack={
          canGoBack(tabs)
            ? () => {
                setTabs(back);
              }
            : null
        }
        onForward={
          canGoForward(tabs)
            ? () => {
                setTabs(forward);
              }
            : null
        }
      />
      <RightSidebar
        sections={sections}
        onJump={jumpTo}
        hidden={!open.right}
        showThink={threadRequest?.n ?? 0}
        think={
          <Think
            docPath={doc && sections ? doc.path : null}
            docText={docText}
            tree={sections}
            section={sections?.sections[cursorSection] ?? sections?.sections[0] ?? null}
            writable={folder?.mode === "writable" && doc?.mode === "editable"}
            request={threadRequest}
            onJump={jumpTo}
          />
        }
      />
      <StatusBar
        version={version}
        folder={shown}
        docMode={doc?.mode ?? null}
        saveStatus={doc ? save.status : null}
        source={source}
        onToggleSource={() => {
          setSource((s) => !s);
        }}
      />
      {open.left ? (
        <Resizer
          side="left"
          width={widths.left}
          offset={48 + widths.left}
          onChange={setWidth("left")}
        />
      ) : null}
      {open.right ? (
        <Resizer
          side="right"
          width={widths.right}
          offset={widths.right}
          onChange={setWidth("right")}
        />
      ) : null}
      {merging ? (
        <MergeDialog
          copy={merging}
          onClose={() => {
            setMerging(null);
          }}
        />
      ) : null}
      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false);
        }}
        folder={shown}
        onOpen={openDoc}
        onOpenLine={openLine}
        onNewDoc={folder?.mode === "writable" ? newDoc : null}
      />
      {settings ? (
        <Settings
          section={settings}
          onSection={setSettings}
          onClose={closeSettings}
          folder={folder}
          onOpenFolder={openFolder}
        />
      ) : null}
    </div>
  );
}
