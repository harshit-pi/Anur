import { EditorView } from "@codemirror/view";
import type { SectionTree } from "@anur/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { settled } from "./editor/pending-saves.ts";
import { freeName, renamed } from "./layout/file-tree.ts";
import type { FileActions } from "./regions/FileTree.tsx";
import type { FileNotice } from "./regions/Regions.tsx";
import { isDrawing, isViewable } from "./layout/file-tree.ts";
import { DrawingView } from "./regions/DrawingView.tsx";
import {
  FileHistory,
  moveLabel,
  reversed,
  type FileStep,
  type Gone,
  type Move,
} from "./layout/file-history.ts";
import { ImageView } from "./regions/ImageView.tsx";
import { SystemView } from "./regions/SystemView.tsx";
import { TaskView } from "./regions/TaskView.tsx";
import { taskIdOf, taskTab, taskTitle, type TaskReport } from "./layout/task-report.ts";
import { SYSTEM_TAB } from "./layout/system-levels.ts";
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
  closeWhere,
  currentDoc,
  cycle,
  docOf,
  forward,
  listItems,
  loadTabs,
  newTab,
  noTabs,
  open as openInTab,
  showSystem,
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
import {
  Center,
  LeftSidebar,
  OutlinePanel,
  Ribbon,
  RightSidebar,
  StatusBar,
} from "./regions/Regions.tsx";
import { TabBar } from "./regions/TabBar.tsx";
import { SkillCard } from "./regions/SkillCard.tsx";
import { PublicRepoCard } from "./regions/PublicRepoCard.tsx";
import { EngineeringCard } from "./regions/EngineeringCard.tsx";
import { UpdateCard, WhatsNewCard } from "./regions/UpdateCard.tsx";
import { OpenerCard } from "./regions/OpenerCard.tsx";
import { Tour } from "./regions/Tour.tsx";
import { tourSteps } from "./layout/tour.ts";
import { useFeatures } from "./features.ts";
import { MapView } from "./regions/MapView.tsx";
import { StarPrompt } from "./regions/StarPrompt.tsx";
import { keepSame } from "./layout/keep-same.ts";
import { redo as redoEdit, undo as undoEdit } from "@codemirror/commands";

export function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Docs opened lately in this folder, the latest first, for the palette's ranking. */
  const [recentDocs, setRecentDocs] = useState<string[]>([]);
  /** The settings section shown, or null when settings are closed (2.25). */
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const closeSettings = useCallback(() => {
    setSettings(null);
  }, []);
  // From the side chat's "Change" next to the auto-apply line.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { section } = (e as CustomEvent<{ section: SettingsSection }>).detail;
      setSettings(section);
    };
    window.addEventListener("anur:open-settings", onOpen);
    return () => {
      window.removeEventListener("anur:open-settings", onOpen);
    };
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
  /** The section the outline marks: the cursor's, the map's pick, or the one scrolled to. */
  const [outlineAt, setOutlineAt] = useState(0);
  /** When the cursor or a pick last set the mark: the scroll a jump causes doesn't move it. */
  const markedAt = useRef(0);
  /** Page or Map in the centre (task 7). */
  const [centerView, setCenterView] = useState<"page" | "map">("page");
  const TOUR = tourSteps(useFeatures());
  /** The tour's step while it runs (null otherwise), and Help → Show the Tour Again. */
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [tourAsked, setTourAsked] = useState(0);
  const tourChecked = useRef(false);
  const centerNow = useRef(centerView);
  centerNow.current = centerView;
  const sectionsNow = useRef(sections);
  sectionsNow.current = sections;
  const onCursor = useCallback((pos: number) => {
    const tree = sectionsNow.current;
    const at = tree ? (sectionAt(tree, pos)?.index ?? 0) : 0;
    setCursorSection((i) => (i === at ? i : at));
    setOutlineAt(at);
    markedAt.current = Date.now();
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
  const pageView = useCallback(() => view.current, []);
  const onView = useCallback((v: EditorView | null) => {
    view.current = v;
    // Check runs only: a probe can set a selection exactly as a mouse would.
    if (window.location.hash === "#check") {
      (window as unknown as { anurView?: EditorView | null }).anurView = v;
    }
  }, []);

  // Read in the open effect, not a dependency: a changed listing (an iCloud
  // download, a file added) mustn't close and reopen the doc being read.
  const folderNow = useRef(folder);
  folderNow.current = folder;
  const openedIn = folder?.path ?? null;

  // Open the picked doc; an offloaded one downloads from iCloud first.
  useEffect(() => {
    const folder = folderNow.current;
    setDoc(null);
    setSections(null);
    setDocError(null);
    // An image shows in its own view, not on the page.
    if (
      !selected ||
      isViewable(selected) ||
      isDrawing(selected) ||
      selected === SYSTEM_TAB ||
      taskIdOf(selected)
    ) {
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
  }, [selected, openedIn]);

  // Each folder has its own tabs, remembered on this device.
  const folderPath = folder?.path ?? null;
  // A folder with drawings: Excalidraw loads a few seconds after it opens,
  // while Anur is idle, so the first drawing shown doesn't wait for it.
  const hasDrawings = folder?.docs.some((d) => isDrawing(d)) ?? false;
  useEffect(() => {
    if (!hasDrawings) return;
    const t = window.setTimeout(() => {
      window.requestIdleCallback(() => {
        void import("./editor/drawings/drawing-widget.ts").then((m) => {
          m.loadAhead();
        });
      });
    }, 3000);
    return () => {
      window.clearTimeout(t);
    };
  }, [hasDrawings]);
  // Remembered on this Mac per folder: the palette ranks these docs higher.
  useEffect(() => {
    if (!folderPath) return;
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(`anur.recent:${folderPath}`) ?? "[]",
      ) as unknown;
      setRecentDocs(Array.isArray(saved) ? saved.filter((d) => typeof d === "string") : []);
    } catch {
      setRecentDocs([]);
    }
  }, [folderPath]);
  useEffect(() => {
    if (!folderPath || !selected) return;
    setRecentDocs((r) => {
      const next = [selected, ...r.filter((d) => d !== selected)].slice(0, 50);
      try {
        window.localStorage.setItem(`anur.recent:${folderPath}`, JSON.stringify(next));
      } catch {
        // Storage blocked: the ranking just forgets.
      }
      return next;
    });
  }, [folderPath, selected]);
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
  // The system tab shows while Engineering is on for the folder (group 20).
  const [engineeringOn, setEngineeringOn] = useState(false);
  /** The folder the System tab was last brought forward for on opening; once per opening. */
  const systemShownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!folderPath || settings) return;
    let current = true;
    void anur.call("plugins:list", {}).then((r) => {
      if (!current) return;
      const on = r.plugins.some((p) => p.id === "engineering" && p.on);
      setEngineeringOn(on);
      // A folder opened with Engineering on starts on its System tab.
      if (on && systemShownFor.current !== folderPath) {
        systemShownFor.current = folderPath;
        setTabs((t) => showSystem(t));
      }
    });
    return () => {
      current = false;
    };
  }, [folderPath, settings]);
  // Recent task reports, listed under System in the files panel (group 21).
  const [recentTasks, setRecentTasks] = useState<TaskReport[]>([]);
  useEffect(() => {
    if (!engineeringOn) {
      setRecentTasks([]);
      return;
    }
    const read = () => {
      void anur.call("tasks:list", {}).then((r) => {
        setRecentTasks(r.reports.slice(0, 5));
      });
    };
    read();
    return anur.on("tasks:changed", read);
  }, [engineeringOn, folderPath]);
  // The system's repos, gathered under Repos in the files panel, closed until opened.
  const [repoDirs, setRepoDirs] = useState<{ dir: string; copyOf: string | null }[]>([]);
  useEffect(() => {
    if (!engineeringOn) {
      setRepoDirs([]);
      return;
    }
    let current = true;
    const read = () => {
      void anur.call("system:repoDirs", {}).then((r) => {
        if (current) setRepoDirs(r.repos);
      });
    };
    read();
    const off = anur.on("system:changed", read);
    return () => {
      current = false;
      off();
    };
  }, [engineeringOn, folderPath]);
  const openSystem = useCallback(() => {
    setTabs((t) => showSystem(t));
  }, []);
  // Engineering switched on, from Settings or the card: the System tab at once.
  useEffect(() => {
    const on = () => {
      setSettings(null);
      setEngineeringOn(true);
      openSystem();
    };
    // Undo on the notice: the System row goes at once.
    const off = () => {
      setEngineeringOn(false);
    };
    window.addEventListener("anur:engineering-on", on);
    window.addEventListener("anur:engineering-off", off);
    return () => {
      window.removeEventListener("anur:engineering-on", on);
      window.removeEventListener("anur:engineering-off", off);
    };
  }, [openSystem]);
  const openDocNow = useRef<(path: string, inNewTab: boolean) => void>(() => undefined);
  const openDoc = useCallback((path: string, inNewTab: boolean) => {
    setTabs((t) => openInTab(t, path, inNewTab));
  }, []);
  openDocNow.current = openDoc;
  useEffect(() => {
    // ⌘ held on the click that asked for a doc: it opens in a new tab, wherever
    // the link was (the map, Think, a thread's notes), as in a browser.
    let modAt = 0;
    const onPress = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey) modAt = Date.now();
    };
    window.addEventListener("pointerdown", onPress, true);
    window.addEventListener("click", onPress, true);
    // A doc named in a thread, such as one an agent made (15.6), opens in this tab.
    const onOpen = (e: Event) => {
      const { path, heading, newTab } = (
        e as CustomEvent<{ path: string; heading?: string | null; newTab?: boolean }>
      ).detail;
      // A linked section (8.3) opens where it is.
      if (heading) setPendingHeading({ path, heading });
      openDocNow.current(path, newTab ?? Date.now() - modAt < 600);
    };
    window.addEventListener("anur:open-path", onOpen);
    // A doc deleted or moved outside Anur: its tabs close.
    const onGone = (e: Event) => {
      const { path } = (e as CustomEvent<{ path: string }>).detail;
      setTabs((t) => closeWhere(t, (tab) => docOf(tab) === path));
    };
    window.addEventListener("anur:doc-gone", onGone);
    return () => {
      window.removeEventListener("anur:doc-gone", onGone);
      window.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("click", onPress, true);
      window.removeEventListener("anur:open-path", onOpen);
    };
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
  const [fileNotice, setFileNotice] = useState<FileNotice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((notice: FileNotice | null, ms: number | null) => {
    setFileNotice(notice);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (notice && ms !== null)
      noticeTimer.current = setTimeout(() => {
        setFileNotice(null);
      }, ms);
  }, []);
  const tell = useCallback(
    (reason: string) => {
      show({ text: reason, tone: "error" }, 6000);
    },
    [show],
  );
  /** After a rename or move: if links to those docs broke, offer to write them again. */
  const offerLinks = useCallback(
    async (moves: { from: string; to: string }[]) => {
      if (moves.length === 0) return;
      const plan = await anur.call("links:plan", { moves });
      if (plan.links === 0) return;
      const dismiss = () => {
        show(null, null);
      };
      const n = (k: number, one: string, many: string) => `${String(k)} ${k === 1 ? one : many}`;
      show(
        {
          text: `${n(plan.links, "link", "links")} in ${n(plan.docs, "doc", "docs")} pointed at the old ${moves.length === 1 ? "name" : "names"}.`,
          tone: "info",
          action: {
            label: "Update links",
            run: () => {
              dismiss();
              void anur.call("links:update", { moves }).then((r) => {
                const left =
                  r.skipped > 0
                    ? ` ${n(r.skipped, "doc", "docs")} changed meanwhile and ${r.skipped === 1 ? "was" : "were"} left as ${r.skipped === 1 ? "it was" : "they were"}.`
                    : "";
                show(
                  {
                    text: `Updated ${n(r.links, "link", "links")} in ${n(r.docs, "doc", "docs")}.${left}`,
                    tone: "info",
                  },
                  5000,
                );
              });
            },
          },
          dismiss,
        },
        null,
      );
    },
    [show],
  );
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
  /** What the files panel did, to undo and redo; it starts again with each folder. */
  const history = useRef(new FileHistory());
  const [, setHistoryTick] = useState(0);
  const folderPathNow = folder?.path ?? null;
  useEffect(() => {
    history.current.clear();
  }, [folderPathNow]);
  const fileActions = useMemo((): FileActions | undefined => {
    if (!folder || folder.mode !== "writable") return undefined;
    const record = (step: FileStep) => {
      history.current.record(step);
      setHistoryTick((n) => n + 1);
    };
    /** Move, stopping at the first that fails; returns those done. */
    const doMoves = (moves: Move[]) =>
      touching(
        moves.map((m) => m.from),
        async () => {
          const done: Move[] = [];
          const docs: Move[] = [];
          for (const { from, to } of moves) {
            const r = await anur.call("file:move", { from, to });
            if (r.kind === "failed") {
              tell(r.reason);
              break;
            }
            done.push({ from, to });
            docs.push(...r.docs);
            setTabs((t) => renamePaths(t, r.docs));
            setFolder(r.folder);
          }
          void offerLinks(docs);
          return done;
        },
      );
    /** Trash, stopping at the first that fails; returns where each went. */
    const doTrash = (paths: string[]) =>
      touching(paths, async () => {
        const gone: Gone[] = [];
        for (const path of paths) {
          const r = await anur.call("file:trash", { path });
          if (r.kind === "failed") {
            tell(r.reason);
            break;
          }
          gone.push({ path, trashed: r.trashed });
          setTabs((t) => prune(t, r.folder.docs));
          setFolder(r.folder);
        }
        return gone;
      });
    /** Bring trashed items back; returns the paths back in place. */
    const doRestore = async (items: Gone[]) => {
      const back: string[] = [];
      for (const { path, trashed } of [...items].reverse()) {
        const name = path.split("/").pop() ?? path;
        if (!trashed) {
          tell(`Find ${name} in the Trash and choose Put Back.`);
          break;
        }
        const r = await anur.call("file:restore", { path, trashed });
        if (r.kind === "failed") {
          tell(r.reason);
          break;
        }
        back.push(r.path);
        setFolder(r.folder);
      }
      return back;
    };
    /** Undo or redo one step; resolves with the paths it touched, to show them. */
    const turn = async (which: "undo" | "redo"): Promise<string[] | null> => {
      const h = history.current;
      const step = which === "undo" ? h.takeUndo() : h.takeRedo();
      setHistoryTick((n) => n + 1);
      if (!step) return null;
      const put = (next: FileStep) => {
        if (which === "undo") h.undid(next);
        else h.redid(next);
        setHistoryTick((n) => n + 1);
      };
      if (step.kind === "move") {
        const want = which === "undo" ? reversed(step.moves) : step.moves;
        const done = await doMoves(want);
        if (done.length === want.length) put(step);
        return done.map((m) => m.to);
      }
      const bringBack =
        (step.kind === "trash" && which === "undo") || (step.kind === "create" && which === "redo");
      if (bringBack) {
        const items = step.kind === "trash" ? step.items : step.gone;
        const back = await doRestore(items);
        if (back.length === items.length) put(step);
        return back;
      }
      const paths = step.kind === "trash" ? step.items.map((i) => i.path) : step.paths;
      const gone = await doTrash(paths);
      if (gone.length === paths.length)
        put(step.kind === "trash" ? { ...step, items: gone } : { ...step, gone });
      return [];
    };
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
        record({ label: "New doc", kind: "create", paths: [r.path], gone: [] });
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
        record({ label: "New folder", kind: "create", paths: [r.path], gone: [] });
        return r.path;
      },
      move: async (moves) => {
        const done = await doMoves(moves);
        if (done.length) record({ label: moveLabel(done), kind: "move", moves: done });
        return done.length === moves.length;
      },
      duplicate: async (path) => {
        const r = await anur.call("file:duplicate", { path });
        if (r.kind === "failed") {
          tell(r.reason);
          return;
        }
        setFolder(r.folder);
        record({ label: "Duplicate", kind: "create", paths: [r.path], gone: [] });
      },
      trash: async (items) => {
        const first = items[0];
        if (!first) return;
        const what = first.path.split("/").pop() ?? first.path;
        const files = items.reduce((n, i) => n + i.docs, 0);
        // A file goes quietly, since Undo or Finder can put it back; folders with files in them ask first.
        const question =
          items.length > 1
            ? `Move these ${String(items.length)} items to the Trash?`
            : `Move “${what}” and the ${String(files)} ${files === 1 ? "file" : "files"} in it to the Trash?`;
        if (items.some((i) => i.isFolder && i.docs > 0) && !window.confirm(question)) return;
        const gone = await doTrash(items.map((i) => i.path));
        if (gone.length) record({ label: "Move to Trash", kind: "trash", items: gone });
      },
      importIncoming: async (data, into) => {
        const r = await anur.call("file:incoming", { into, ...data });
        if (r.kind === "failed") {
          tell(r.reason);
          return null;
        }
        setFolder(r.folder);
        const paths = r.kind === "copied" ? r.paths : [r.path];
        if (paths.length)
          record({
            label: r.kind === "made" ? "New doc" : "Add files",
            kind: "create",
            paths,
            gone: [],
          });
        // Text made into a doc opens, so it can be read and named.
        if (r.kind === "made") openDoc(r.path, false);
        return paths;
      },
      importFiles: async (sources, into) => {
        const r = await anur.call("file:import", { sources, into });
        if (r.kind === "failed") {
          tell(r.reason);
          return null;
        }
        setFolder(r.folder);
        if (r.paths.length)
          record({ label: "Add files", kind: "create", paths: r.paths, gone: [] });
        return r.paths;
      },
      undo: () => turn("undo"),
      redo: () => turn("redo"),
      history: () => history.current.labels(),
    };
  }, [folder, openDoc, tell, touching, offerLinks]);
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
  /** A box picked on the map: Think shows its section, and the page's cursor moves there unseen. */
  const pickOnMap = useCallback(
    (index: number) => {
      setCursorSection(index);
      setOutlineAt(index);
      setOpen((o) => {
        if (o.right) return o;
        const next = { ...o, right: true };
        saveOpen(window.localStorage, next);
        return next;
      });
      const target = sections?.sections[index]?.headingRange;
      const v = view.current;
      if (target && v) v.dispatch({ selection: { anchor: target.to } });
    },
    [sections],
  );
  /** Think on a section, ready to type: the right panel open, its box in focus. */
  const thinkOn = useCallback((index: number | null) => {
    if (index !== null) {
      setCursorSection(index);
      setOutlineAt(index);
    }
    setOpen((o) => {
      if (o.right) return o;
      const next = { ...o, right: true };
      saveOpen(window.localStorage, next);
      return next;
    });
    // After Think has shown the section's new-thread box.
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(".think .think-back")?.click();
      window.setTimeout(() => {
        document.querySelector<HTMLTextAreaElement>(".think .think-input")?.focus();
      }, 60);
    }, 60);
  }, []);
  /** Ask (4.8): a thread on the doc's title, whose text is the whole doc. */
  const ask = useCallback(() => {
    thinkOn(0);
  }, [thinkOn]);
  /**
   * A section added on the map: a heading one level under `parent`, after
   * everything already under it. Returns its heading path.
   */
  const addSection = useCallback(
    (parent: number, name: string): string[] | null => {
      const v = view.current;
      const p = sections?.sections[parent];
      if (!v || !p) return null;
      const sibling = p.children.map((c) => sections.sections[c]).find(Boolean);
      const level = Math.min(6, sibling ? sibling.level : Math.max(2, p.level + 1));
      const at = p.subtreeRange.to;
      const before = v.state.doc.sliceString(Math.max(0, at - 2), at);
      const lead =
        at === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      const tail = at < v.state.doc.length ? "\n\n" : "\n";
      const insert = `${lead}${"#".repeat(level)} ${name}${tail}`;
      v.dispatch({ changes: { from: at, insert }, userEvent: "input.map" });
      return [...p.path, name];
    },
    [sections],
  );
  // Back from the map, the page opens at the section picked there.
  const lastView = useRef(centerView);
  useEffect(() => {
    const was = lastView.current;
    lastView.current = centerView;
    if (was !== "map" || centerView !== "page") return;
    // After the page is shown again: a hidden editor can't scroll.
    requestAnimationFrame(() => {
      jumpTo(cursorSection);
    });
  }, [centerView, cursorSection, jumpTo]);
  // Scrolling the page moves the outline's mark to the section at the top.
  useEffect(() => {
    const v = view.current;
    if (!v || !sections || centerView !== "page") return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (Date.now() - markedAt.current < 600) return;
        const top = v.lineBlockAtHeight(v.scrollDOM.scrollTop + 40).from;
        const at = sectionAt(sections, top)?.index;
        if (at !== undefined) setOutlineAt(at);
      });
    };
    v.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      v.scrollDOM.removeEventListener("scroll", onScroll);
    };
  }, [sections, centerView, doc]);
  /** A section deleted on the map: its heading, text and subsections, as one undoable edit. */
  /**
   * A section renamed on the map: its heading line changes, or a title is
   * written. The title's new name is the file's too, as in the files panel.
   */
  const renameSection = useCallback(
    (index: number, name: string) => {
      const v = view.current;
      const s = sections?.sections[index];
      if (!v || !s) return;
      const clean = name.replace(/\s+/g, " ").trim();
      if (!s.headingRange) {
        // A doc with no title yet: the name becomes its first line.
        v.dispatch({ changes: { from: 0, insert: `# ${clean}\n\n` }, userEvent: "input.map" });
      } else {
        const line = v.state.doc.sliceString(s.headingRange.from, s.headingRange.to);
        const m = /^(\s{0,3}#{1,6}[ \t]+)(.*?)([ \t]+#+[ \t]*)?$/.exec(line.replace(/\n$/, ""));
        if (!m) return;
        const from = s.headingRange.from + (m[1]?.length ?? 0);
        v.dispatch({
          changes: { from, to: from + (m[2]?.length ?? 0), insert: clean },
          userEvent: "input.map",
        });
      }
      if (index !== 0 || !selected || !fileActions || !folder) return;
      const to = renamed(selected, clean.replace(/[*?"<>|#^[\]]/g, " "), false);
      if (!to || to === selected) return;
      const taken = folder.docs.some(
        (d) => d.toLowerCase() === to.toLowerCase() && d.toLowerCase() !== selected.toLowerCase(),
      );
      if (taken) {
        tell(
          `A doc called “${to.split("/").pop() ?? to}” is already here, so the file keeps its name.`,
        );
        return;
      }
      void fileActions.move([{ from: selected, to }]);
    },
    [sections, selected, fileActions, folder, tell],
  );
  const deleteSection = useCallback(
    (index: number) => {
      const v = view.current;
      const s = sections?.sections[index];
      if (!v || !s?.headingRange || index === 0) return false;
      v.dispatch({
        changes: { from: s.headingRange.from, to: s.subtreeRange.to },
        userEvent: "delete.map",
      });
      return true;
    },
    [sections],
  );
  const undoOnPage = useCallback(() => {
    if (view.current) undoEdit(view.current);
  }, []);
  const redoOnPage = useCallback(() => {
    if (view.current) redoEdit(view.current);
  }, []);
  /** A link from one section to another, drawn on the map: `[[#Heading]]` at the end of its text. */
  const addLink = useCallback(
    (from: number, to: number) => {
      const v = view.current;
      const a = sections?.sections[from];
      const b = sections?.sections[to];
      const name = b?.headingRange ? b.path.at(-1) : undefined;
      if (!v || !a || !name) return;
      const text = v.state.doc.sliceString(a.ownRange.from, a.ownRange.to);
      const at = a.ownRange.from + text.trimEnd().length;
      v.dispatch({ changes: { from: at, insert: `\n\n[[#${name}]]` }, userEvent: "input.map" });
    },
    [sections],
  );
  /** The open doc's threads and their tokens, for the status bar (4.10). */
  const [docThreads, setDocThreads] = useState<{ count: number; tokens: number } | null>(null);
  const docPathNow = doc && sections ? doc.path : null;
  useEffect(() => {
    setDocThreads(null);
    if (!docPathNow) return;
    let current = true;
    const load = () => {
      void anur.call("thread:list", { path: docPathNow, text: docText() }).then((r) => {
        if (!current) return;
        const open = r.threads.filter((t) => !t.closed);
        setDocThreads({
          count: open.length,
          tokens: r.threads.reduce((sum, t) => sum + (t.tokens?.used ?? 0), 0),
        });
      });
    };
    load();
    const off = anur.on("thread:event", (e) => {
      if (e.kind === "thread" && e.path === docPathNow) load();
    });
    return () => {
      current = false;
      off();
    };
  }, [docPathNow, docText]);
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
  const docReady = doc !== null && sections !== null;
  // The tour starts once, the first time a doc is open, unless it's been seen.
  useEffect(() => {
    if (!docReady || tourChecked.current) return;
    tourChecked.current = true;
    void anur.call("tour:status", {}).then((t) => {
      if (t.show) setTourStep(0);
    });
  }, [docReady]);
  useEffect(() => {
    if (tourAsked > 0 && docReady) setTourStep(0);
    // Only a new ask: a doc opening later doesn't start it.
  }, [tourAsked]);
  // Each step shows its part: the view it needs, and its side panel open.
  useEffect(() => {
    const s = tourStep === null ? null : TOUR[tourStep];
    if (!s) return;
    setCenterView(s.view);
    const side = s.panel;
    if (side)
      setOpen((o) => {
        if (o[side]) return o;
        const next = { ...o, [side]: true };
        saveOpen(window.localStorage, next);
        return next;
      });
  }, [tourStep]);
  const endTour = useCallback(() => {
    setTourStep(null);
    setCenterView("page");
    void anur.call("tour:done", {});
  }, []);
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
    // From the map: show the page, then show the edit there once the page can scroll.
    const toPage = (e: Event) => {
      if (centerNow.current !== "map") return;
      setCenterView("page");
      const { thread } = (e as CustomEvent<{ thread: string }>).detail;
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("anur:show-preview", { detail: { thread } }));
      }, 120);
    };
    window.addEventListener("anur:show-preview", toPage);
    return () => {
      window.removeEventListener("anur:open-thread", onThread);
      window.removeEventListener("anur:show-preview", toPage);
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
      setFolder((was) => keepSame(was, f));
    });
    // An agent in a terminal asked to show a doc (6.7, 6.9).
    const offOpenDoc = anur.on("app:open-doc", ({ path, section }) => {
      openDocNow.current(path, false);
      if (section) setPendingHeading({ path, heading: section });
    });
    // ⌘← and ⌘→ go back and forward when nothing is being typed in, as in Chrome.
    const onNavKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.shiftKey || e.ctrlKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      setTabs(e.key === "ArrowLeft" ? back : forward);
    };
    window.addEventListener("keydown", onNavKey);
    const offCommand = anur.on("app:command", ({ command }) => {
      if (command === "tab-new") setTabs((t) => newTab(t));
      else if (command === "tab-close") setTabs((t) => (t.active ? close(t, t.active) : t));
      else if (command === "back") setTabs(back);
      else if (command === "forward") setTabs(forward);
      else if (command === "tour") setTourAsked((n) => n + 1);
      else if (command === "updates") setSettings("general");
      else setTabs((t) => cycle(t, command === "tab-next" ? 1 : -1));
    });
    return () => {
      window.removeEventListener("keydown", onNavKey);
      offInsert();
      offFolder();
      offOpenDoc();
      offCommand();
    };
  }, []);

  const openFolder = useCallback(() => {
    void anur.call("folder:choose", {}).then((r) => {
      if (r.kind === "opened") setFolder(r.folder);
    });
  }, []);
  const newFolder = useCallback(() => {
    void anur.call("folder:new", {}).then((r) => {
      if (r.kind === "opened") setFolder(r.folder);
    });
  }, []);
  /** Bumped by "New doc" on an empty folder's page: the files panel starts a new doc. */
  const [makeDoc, setMakeDoc] = useState(0);
  const firstDoc = useCallback(() => {
    setOpen((o) => {
      if (o.left) return o;
      const next = { ...o, left: true };
      saveOpen(window.localStorage, next);
      return next;
    });
    setMakeDoc((n) => n + 1);
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
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setCenterView((v) => (v === "map" ? "page" : "map"));
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
        view={selected === SYSTEM_TAB ? "map" : doc && sections ? centerView : null}
        mapOnly={selected === SYSTEM_TAB}
        onView={setCenterView}
        onAsk={doc && sections ? ask : null}
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
        system={
          engineeringOn
            ? {
                open: selected === SYSTEM_TAB,
                onOpen: openSystem,
                repos: repoDirs,
                tasks: recentTasks.map((r) => ({
                  id: r.id,
                  title: taskTitle(r),
                  open: taskIdOf(selected) === r.id,
                })),
                onTask: (id) => {
                  setTabs((t) => openInTab(t, taskTab(id), false));
                },
              }
            : null
        }
        selected={selected}
        onSelect={openDoc}
        hidden={!open.left}
        reveal={reveal}
        actions={fileActions}
        notice={fileNotice}
        makeDoc={makeDoc}
        outline={<OutlinePanel sections={sections} current={outlineAt} onJump={jumpTo} />}
      />
      <Center
        folder={shown}
        selected={selected}
        page={
          // Only the doc the tab shows: after a rename the old one mustn't mount for a moment.
          selected === SYSTEM_TAB ? (
            <SystemView
              folder={folderPath}
              onPlugins={() => {
                setSettings("core");
              }}
            />
          ) : taskIdOf(selected) ? (
            <TaskView id={taskIdOf(selected) ?? ""} onSystem={openSystem} />
          ) : selected && isViewable(selected) ? (
            <ImageView path={selected} />
          ) : selected && isDrawing(selected) ? (
            <DrawingView key={selected} path={selected} />
          ) : doc && !holding && doc.path === selected ? (
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
        map={
          // A drawing has no sections: it shows as itself on Map too.
          selected && isDrawing(selected) ? null : centerView === "map" &&
            doc &&
            !holding &&
            doc.path === selected &&
            sections ? (
            <MapView
              // A fresh map for each doc: its own framing, positions and history.
              key={doc.path}
              docPath={doc.path}
              tree={sections}
              docText={docText}
              selected={cursorSection}
              onSelect={pickOnMap}
              onAddSection={addSection}
              onLink={addLink}
              onDelete={deleteSection}
              onRename={renameSection}
              onUndo={undoOnPage}
              onRedo={redoOnPage}
              writable={folder?.mode === "writable" && doc.mode === "editable"}
              docs={folder?.docs ?? []}
            />
          ) : centerView === "map" ? (
            // While a doc's sections are read, an empty map, so the page never shows through.
            <div className="map" aria-hidden="true" />
          ) : null
        }
        opening={opening}
        docNote={doc?.note ?? null}
        docError={docError ?? save.detail}
        onOpenFolder={openFolder}
        onNewFolder={newFolder}
        onFirstDoc={firstDoc}
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
        hidden={!open.right}
        think={
          selected === SYSTEM_TAB ? (
            // The system's map fills this with recent tasks, a line's calls and its repos.
            <div id="system-panel" className="system-panel" />
          ) : (
            <Think
              docPath={doc && sections ? doc.path : null}
              docText={docText}
              tree={sections}
              section={sections?.sections[cursorSection] ?? sections?.sections[0] ?? null}
              writable={folder?.mode === "writable" && doc?.mode === "editable"}
              request={threadRequest}
              onJump={jumpTo}
              page={pageView}
            />
          )
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
        threads={docThreads}
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
      {tourStep !== null ? (
        <Tour
          step={tourStep}
          onStep={(n) => {
            if (n >= TOUR.length) endTour();
            else setTourStep(Math.max(0, n));
          }}
          onEnd={endTour}
        />
      ) : null}
      {/* The offer cards wait until the tour is over. */}
      {tourStep === null ? (
        // One card at a time in the corner, the most pressing first.
        <div className="corner-cards">
          <UpdateCard />
          <WhatsNewCard />
          <PublicRepoCard />
          <EngineeringCard />
          <OpenerCard />
          <SkillCard />
          <StarPrompt />
        </div>
      ) : null}
      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false);
        }}
        folder={shown}
        onOpen={openDoc}
        recent={recentDocs}
        onOpenLine={openLine}
        onNewDoc={folder?.mode === "writable" ? newDoc : null}
        onSwitchView={
          doc && sections
            ? () => {
                setCenterView((v) => (v === "map" ? "page" : "map"));
              }
            : null
        }
        onThread={
          doc && sections
            ? () => {
                thinkOn(null);
              }
            : null
        }
        onAsk={doc && sections ? ask : null}
        onSystem={engineeringOn ? openSystem : null}
      />
      {settings ? (
        <Settings
          section={settings}
          onSection={setSettings}
          onClose={closeSettings}
          folder={folder}
          onOpenFolder={openFolder}
          onTour={
            docReady
              ? () => {
                  closeSettings();
                  setTourStep(0);
                }
              : null
          }
        />
      ) : null}
    </div>
  );
}
