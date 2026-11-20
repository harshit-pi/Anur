import { UpdatePill, VersionItem } from "./UpdatePill.tsx";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { crumbs } from "../layout/path-row.ts";
import type { SectionTree } from "@anur/core";
import type { AgentStatus, FolderState } from "../../../shared/ipc-contract.ts";
import { AGENTS } from "../../../shared/agents.ts";
import { anur } from "../bridge.ts";
import { FileTree, type FileActions, type MakeRequest } from "./FileTree.tsx";
import { OpenFromButtons, PluginStatusItem, usePluginStatuses } from "./PluginUI.tsx";
import { SpaceList, SpaceSwitcher } from "./Spaces.tsx";
import { NoticeBar } from "./NoticeBar.tsx";
import { SORTS, type Sort } from "../layout/file-tree.ts";
import {
  BackIcon,
  CollapseAllIcon,
  FolderIcon,
  ForwardIcon,
  LinkIcon,
  MoreIcon,
  NewDocIcon,
  NewFolderIcon,
  SortIcon,
  PluginsIcon,
  SystemIcon,
  SearchIcon,
  SettingsIcon,
} from "./Icons.tsx";
import { SYSTEM_TAB } from "../layout/system-levels.ts";
import type { SaveStatus } from "../editor/autosave.ts";
import { PROVIDERS, cloudSummary, markNoticeSeen, noticeSeen } from "./cloud-notice.ts";

/**
 * The seven regions, fixed from day 1 (FR10). Plugins and later groups add
 * to them, never new ones. Each is empty until the group that fills it.
 */

/** 1. Ribbon: Files, Search, Plugins, Settings. */
export function Ribbon({
  files,
  filesOpen,
  onFiles,
  searchOpen,
  onSearch,
  onSettings,
  onPlugins,
}: {
  /** A space is open, so there are files to show. */
  files: boolean;
  filesOpen: boolean;
  onFiles: () => void;
  searchOpen: boolean;
  onSearch: () => void;
  onSettings: () => void;
  onPlugins: () => void;
}) {
  return (
    <nav className="ribbon" aria-label="Ribbon">
      {files ? (
        <button
          className={`ribbon-button${filesOpen ? " active" : ""}`}
          type="button"
          aria-label="Files"
          aria-pressed={filesOpen}
          title={filesOpen ? "Hide files (⌘\\)" : "Show files (⌘\\)"}
          onClick={onFiles}
        >
          <FolderIcon />
        </button>
      ) : null}
      <button
        className={`ribbon-button${searchOpen ? " active" : ""}`}
        type="button"
        aria-label="Search"
        aria-pressed={searchOpen}
        title="Search (⌘K)"
        onClick={onSearch}
      >
        <SearchIcon />
      </button>
      <div className="ribbon-spacer" />
      <button
        className="ribbon-button"
        type="button"
        aria-label="Plugins"
        title="Plugins"
        onClick={onPlugins}
      >
        <PluginsIcon />
      </button>
      <button
        className="ribbon-button"
        type="button"
        aria-label="Settings"
        title="Settings (⌘,)"
        onClick={onSettings}
      >
        <SettingsIcon />
      </button>
    </nav>
  );
}

/** A line under the files: a refusal, or an offer such as updating links. */
export type FileNotice = {
  text: string;
  tone: "error" | "info";
  action?: { label: string; run: () => void };
  dismiss?: () => void;
};

const SORT_LABELS: Record<Sort, string> = {
  name: "Name (A to Z)",
  "name-desc": "Name (Z to A)",
  modified: "Last changed",
  created: "Created",
};

/** The files panel's sort, remembered per folder on this device. */
function loadSort(folder: string): Sort {
  try {
    const raw = window.localStorage.getItem(`anur.sort:${folder}`);
    return SORTS.find((s) => s === raw) ?? "name";
  } catch {
    return "name";
  }
}

/** 2. Left sidebar: the folder's files, made, renamed, moved and trashed here. */
export function LeftSidebar({
  folder,
  selected,
  onSelect,
  hidden,
  reveal,
  actions,
  notice = null,
  makeDoc = 0,
  outline = null,
  system = null,
  onNewSpace,
  onOpenFolder: onOpenSpaceFolder,
  opening = false,
}: {
  /** The folder's system map, when Engineering is on: a row above the files. */
  system?: {
    open: boolean;
    onOpen: () => void;
    /** The system's repos, folder-relative: gathered under Repos, closed until opened; a second clone names its original. */
    repos: readonly { dir: string; copyOf: string | null }[];
    /** Recent task reports, newest first, under the Repos row. */
    tasks: { id: string; title: string; open: boolean }[];
    onTask: (id: string) => void;
  } | null;
  /** The open doc's outline, under the files; folds away. */
  outline?: ReactNode;
  folder: FolderState | null;
  selected: string | null;
  onSelect: (path: string, inNewTab: boolean) => void;
  /** Collapsed: kept mounted, so folders stay expanded as they were. */
  hidden: boolean;
  /** Changes whenever a tab is pressed or a doc comes into focus: reveal it in the tree. */
  reveal: number;
  actions?: FileActions | undefined;
  /** Why the last change to the files didn't happen, or what it offers next. */
  notice?: FileNotice | null;
  /** Bumped to start a new doc, as an empty folder's page asks. */
  makeDoc?: number;
  /** The space switcher's New space and Open folder as space. */
  onNewSpace?: () => void;
  onOpenFolder?: () => void;
  /** A space is opening into this window: say nothing yet, so the start text doesn't flash. */
  opening?: boolean;
}) {
  const [collapse, setCollapse] = useState(0);
  // The repos a system found sit under Repos, closed until opened: code
  // first, so the rest of the tree is the folder's docs.
  const [reposOpen, setReposOpen] = useState(false);
  const repoList = (system?.repos ?? []).map((r) => r.dir);
  const repoCount = (system?.repos ?? []).filter((r) => !r.copyOf).length;
  const copyNotes = Object.fromEntries(
    (system?.repos ?? []).flatMap((r) => (r.copyOf ? [[r.dir, `copy of ${r.copyOf}`]] : [])),
  );
  const inRepo = (p: string) => repoList.some((r) => p === r || p.startsWith(`${r}/`));
  /** The folders above a nested repo, so it shows at its own path under Repos. */
  const repoAncestors = new Set(
    repoList.flatMap((r) =>
      r
        .split("/")
        .slice(0, -1)
        .map((_, i, a) => a.slice(0, i + 1).join("/")),
    ),
  );
  const [request, setRequest] = useState<MakeRequest | null>(null);
  useEffect(() => {
    if (makeDoc > 0) setRequest((r) => ({ kind: "doc", n: (r?.n ?? 0) + 1 }));
  }, [makeDoc]);
  const folderPath = folder?.path ?? null;
  const [sort, setSort] = useState<Sort>("name");
  useEffect(() => {
    if (folderPath) setSort(loadSort(folderPath));
  }, [folderPath]);
  if (!folder && opening)
    return <aside className="left-sidebar" aria-label="Files" hidden={hidden} />;
  if (!folder) {
    return (
      <aside className="left-sidebar" aria-label="Files" hidden={hidden}>
        <p className="sidebar-title truncate" title="No folder open">
          No folder open
        </p>
        <p className="quiet">
          Make a new folder for your docs, or open one of Markdown files you already have. Anur
          works on the files as they are.
        </p>
      </aside>
    );
  }
  const editable = folder.mode === "writable";
  const chooseSort = () => {
    void anur
      .call("menu:popup", {
        items: SORTS.map((s) => ({ id: s, label: SORT_LABELS[s], checked: s === sort })),
      })
      .then(({ id }) => {
        const next = SORTS.find((s) => s === id);
        if (!next) return;
        setSort(next);
        try {
          window.localStorage.setItem(`anur.sort:${folder.path}`, next);
        } catch {
          // Storage blocked: the sort just isn't remembered.
        }
      });
  };
  return (
    <aside className="left-sidebar" aria-label="Files" hidden={hidden}>
      <div className="sidebar-head">
        {/* The space's name sits at the foot, in its switcher (Spaces mock). */}
        <span className="sidebar-title" />
        {editable ? (
          <>
            <button
              type="button"
              className="icon-button"
              aria-label="New doc"
              title="New doc"
              onClick={() => {
                setRequest((r) => ({ kind: "doc", n: (r?.n ?? 0) + 1 }));
              }}
            >
              <NewDocIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="New folder"
              title="New folder"
              onClick={() => {
                setRequest((r) => ({ kind: "folder", n: (r?.n ?? 0) + 1 }));
              }}
            >
              <NewFolderIcon />
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="icon-button"
          aria-label="Sort"
          title={`Sort: ${SORT_LABELS[sort]}`}
          onClick={chooseSort}
        >
          <SortIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Collapse all folders"
          title="Collapse all"
          onClick={() => {
            setCollapse((n) => n + 1);
          }}
        >
          <CollapseAllIcon />
        </button>
      </div>
      {system ? (
        <div className={`tree-row system-row${system.open ? " selected" : ""}`}>
          {system.repos.length ? (
            <button
              type="button"
              className="system-caret"
              aria-label={reposOpen ? "Hide the repos" : "Show the repos"}
              aria-expanded={reposOpen}
              onClick={() => {
                setReposOpen((o) => !o);
              }}
            >
              <span className={`caret${reposOpen ? " open" : ""}`} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="system-open-map"
            title="The folder's repos and the links between them, as a map"
            onClick={system.onOpen}
          >
            <SystemIcon />
            <span className="truncate">Repos</span>
            {system.repos.length ? <span className="quiet system-count">{repoCount}</span> : null}
          </button>
        </div>
      ) : null}
      {system && reposOpen && system.repos.length ? (
        <div className="system-repos">
          <FileTree
            root={folder.path}
            docs={folder.docs.filter(inRepo)}
            folders={[...new Set([...repoAncestors, ...folder.folders.filter(inRepo)])]}
            files={folder.files.filter(inRepo)}
            times={folder.times}
            sort={sort}
            offloaded={folder.offloaded}
            selected={selected}
            onSelect={onSelect}
            reveal={reveal}
            collapse={collapse}
            actions={actions}
            editable={editable}
            request={null}
            notes={copyNotes}
          />
        </div>
      ) : null}
      {system?.tasks.length ? (
        <ul className="system-tasks-tree" aria-label="Recent tasks">
          {system.tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={`tree-row task-row${t.open ? " selected" : ""}`}
                title={`Task report: ${t.title}`}
                onClick={() => {
                  system.onTask(t.id);
                }}
              >
                <span className="truncate">{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <FileTree
        root={folder.path}
        docs={folder.docs.filter((p) => !inRepo(p))}
        folders={folder.folders.filter((p) => !inRepo(p))}
        files={folder.files.filter((p) => !inRepo(p))}
        times={folder.times}
        sort={sort}
        offloaded={folder.offloaded}
        selected={selected}
        onSelect={onSelect}
        reveal={reveal}
        collapse={collapse}
        actions={actions}
        editable={editable}
        request={request}
      />
      {notice ? (
        <div
          className={`tree-notice ${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
          {notice.action ? (
            <span className="tree-notice-actions">
              <button type="button" className="tree-notice-button" onClick={notice.action.run}>
                {notice.action.label}
              </button>
              <button type="button" className="tree-notice-dismiss" onClick={notice.dismiss}>
                Not now
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      {folder.truncated ? (
        <p className="quiet">This folder has more files than Anur lists; some are left out.</p>
      ) : null}
      {outline}
      <SpaceSwitcher
        name={folder.name}
        path={folder.path}
        onNewSpace={() => onNewSpace?.()}
        onOpenFolder={() => onOpenSpaceFolder?.()}
      />
    </aside>
  );
}

/** A notice about where the folder lives. */
function FolderNotices({ folder }: { folder: FolderState }) {
  // Once per folder: dismissed, it stays dismissed on this Mac, and the
  // status bar's cloud item carries the same words.
  const [dismissed, setDismissed] = useState(() => noticeSeen(window.localStorage, folder.path));
  const summary = cloudSummary(folder);
  return (
    <>
      {summary && !dismissed ? (
        <NoticeBar
          tone="info"
          closeTitle="Close; the status bar keeps this"
          onClose={() => {
            markNoticeSeen(window.localStorage, folder.path);
            setDismissed(true);
          }}
        >
          {summary.join(" ")}
        </NoticeBar>
      ) : null}
    </>
  );
}

/** 4. Center: the page or the map, per tab, under the path row. */
export function Center({
  folder,
  selected,
  page,
  map,
  opening,
  docNote,
  docError,
  spaceNotice = null,
  spaceOpening = null,
  openOnMap = false,
  onOpenFolder,
  onNewFolder,
  onFirstDoc,
  onBack,
  onForward,
  onCrumb,
  onCopyLink,
  onMore,
}: {
  folder: FolderState | null;
  selected: string | null;
  /** A breadcrumb was pressed: show a menu of what the folder it names holds. */
  onCrumb: (folder: string) => void;
  /** Copy a link to the section at the cursor; resolves with it once copied, or null. */
  onCopyLink: () => Promise<string | null>;
  onMore: () => void;
  /** Back and forward in the active tab; null where there's nowhere to go. */
  onBack: (() => void) | null;
  onForward: (() => void) | null;
  /** The open doc's page, once it has loaded. */
  page: ReactNode;
  /** The map, when the tab shows it; the page stays mounted under it. */
  map?: ReactNode;
  /** What is happening while a doc loads, such as a download from iCloud. */
  opening: string | null;
  docNote: string | null;
  docError: string | null;
  /** A note about the space, shown once: a folder asked for opened as part of its space. */
  spaceNotice?: string | null;
  /** The space this window is opening, before it's in: shown in place of the start page. */
  spaceOpening?: string | null;
  /** Docs open on the map by default: a space opening shows on the map's canvas. */
  openOnMap?: boolean;
  onOpenFolder: () => void;
  onNewFolder: () => void;
  /** Start the first doc in an empty folder. */
  onFirstDoc: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  // Bars closed on this doc; another doc shows its own again.
  const [closed, setClosed] = useState<{ doc: string | null; texts: ReadonlySet<string> }>({
    doc: selected,
    texts: new Set(),
  });
  const closedNow = closed.doc === selected ? closed.texts : new Set<string>();
  const close = (text: string) => {
    setClosed({ doc: selected, texts: new Set([...closedNow, text]) });
  };
  // The system tab is no file: no path to walk, nothing to link or move.
  const isSystem = selected === SYSTEM_TAB || !!selected?.startsWith("anur:task/");
  return (
    <main className="center">
      {/* With no space open, there's no doc to show a path for. */}
      {folder ? (
        <div className="path-row">
          <button
            className="icon-button"
            type="button"
            aria-label="Back"
            title="Back (⌘⌥←)"
            disabled={!onBack}
            onClick={onBack ?? undefined}
          >
            <BackIcon />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Forward"
            title="Forward (⌘⌥→)"
            disabled={!onForward}
            onClick={onForward ?? undefined}
          >
            <ForwardIcon />
          </button>
          <nav className="path crumbs" aria-label="Path" title={selected ?? undefined}>
            {isSystem ? (
              <span className="crumb">{selected === SYSTEM_TAB ? "Repos" : "Task report"}</span>
            ) : selected ? (
              crumbs(selected).map((c, i) => (
                <Fragment key={`${String(i)}-${c.label}`}>
                  {i > 0 ? (
                    <span className="crumb-sep" aria-hidden="true">
                      /
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="crumb truncate"
                    title={c.lists ? `What's in ${c.lists}` : `What's in ${folder.name}`}
                    onClick={() => {
                      onCrumb(c.lists);
                    }}
                  >
                    {c.label}
                  </button>
                </Fragment>
              ))
            ) : null}
          </nav>
          <div className="path-actions" hidden={isSystem}>
            {copied ? (
              <span className="copied" role="status">
                Copied <span className="copied-link">{copied}</span>
              </span>
            ) : null}
            <button
              className="icon-button"
              type="button"
              aria-label="Copy a link to this section"
              title="Copy a link to the section the cursor is in"
              disabled={!selected}
              onClick={() => {
                void onCopyLink().then((link) => {
                  if (!link) return;
                  setCopied(link);
                  setTimeout(() => {
                    setCopied((c) => (c === link ? null : c));
                  }, 2000);
                });
              }}
            >
              <LinkIcon />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="More"
              title="More"
              disabled={!selected}
              onClick={onMore}
            >
              <MoreIcon />
            </button>
          </div>
        </div>
      ) : null}
      {folder ? <FolderNotices key={folder.path} folder={folder} /> : null}
      {folder?.mode === "read-only" && !closedNow.has(`read-only:${folder.reason ?? ""}`) ? (
        <NoticeBar
          tone="info"
          onClose={() => {
            close(`read-only:${folder.reason ?? ""}`);
          }}
        >
          <strong>Read-only.</strong> {folder.reason}
        </NoticeBar>
      ) : null}
      {docNote && !closedNow.has(docNote) ? (
        <NoticeBar
          tone="info"
          onClose={() => {
            close(docNote);
          }}
        >
          {docNote}
        </NoticeBar>
      ) : null}
      {spaceNotice && !closedNow.has(spaceNotice) ? (
        <NoticeBar
          tone="info"
          onClose={() => {
            close(spaceNotice);
          }}
        >
          {spaceNotice}
        </NoticeBar>
      ) : null}
      {docError && !closedNow.has(docError) ? (
        <NoticeBar
          tone="warn"
          onClose={() => {
            close(docError);
          }}
        >
          {docError}
        </NoticeBar>
      ) : null}
      {page ? (
        <>
          {page}
          {map}
        </>
      ) : map ? (
        // The doc is away for a moment (moved, renamed, reopening): the map stays.
        map
      ) : opening ? (
        <div className="page-empty">
          <p className="quiet">{opening}</p>
        </div>
      ) : folder && folder.docs.length === 0 && folder.mode === "writable" ? (
        <div className="page-empty">
          <h1>{`${folder.name} is empty`}</h1>
          <p>Start with a doc. Each one is a plain Markdown file in this folder.</p>
          <div className="page-empty-buttons">
            <button className="primary-button" type="button" onClick={onFirstDoc}>
              New doc
            </button>
          </div>
        </div>
      ) : folder ? (
        <div className="page-empty">
          <h1>Pick a doc</h1>
          <p>
            {`${String(folder.docs.length)} Markdown files in ${folder.name}. Pick one on the left.`}
          </p>
        </div>
      ) : spaceOpening && openOnMap ? (
        // Map first, the space opens on the map's canvas, so no page shows before it.
        <div className="map blank-map">
          <div className="space-opening" role="status">
            <h1>{`Opening ${spaceOpening}…`}</h1>
            <div className="space-opening-bar" aria-hidden="true" />
          </div>
        </div>
      ) : spaceOpening ? (
        <div className="page-empty space-opening" role="status">
          <h1>{`Opening ${spaceOpening}…`}</h1>
          <div className="space-opening-bar" aria-hidden="true" />
        </div>
      ) : (
        <div className="page-empty">
          <h1>Open a space</h1>
          <p>
            Think on maps with your own agent. Ask about any box and the thread starts from it, what
            it links to and what earlier threads settled.
          </p>
          <p>
            A space is a folder you work in and share. Every map is also a Markdown file in it, so
            it opens in any editor.
          </p>
          <div className="page-empty-buttons">
            <button className="primary-button" type="button" onClick={onNewFolder}>
              New space
            </button>
            <button className="secondary-button" type="button" onClick={onOpenFolder}>
              Open folder as space <span className="kbd">⌘O</span>
            </button>
            <OpenFromButtons />
          </div>
          <SpaceList />
        </div>
      )}
    </main>
  );
}

function Outline({
  sections,
  current,
  onJump,
}: {
  sections: SectionTree;
  current: number;
  onJump: (index: number) => void;
}) {
  const headed = sections.sections.filter((s) => s.headingRange);
  // The section in focus stays in view as the page scrolls.
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);
  if (headed.length === 0) return <p className="quiet">This doc has no headings yet.</p>;
  return (
    <ul ref={list} className="outline" aria-label="Outline">
      {headed.map((s) => (
        <li key={s.index}>
          <button
            type="button"
            className={s.index === current ? "tree-row selected" : "tree-row"}
            aria-current={s.index === current}
            style={{ paddingLeft: 8 + (s.path.length - 1) * 14 }}
            title={s.path.join(" › ")}
            onClick={() => {
              onJump(s.index);
            }}
          >
            <span className="truncate">{s.path.at(-1)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The open doc's outline, folded under the files in the left panel: its
 * headings, the section in focus marked. Folded or open as last left.
 */
export function OutlinePanel({
  sections,
  current,
  onJump,
}: {
  sections: SectionTree | null;
  current: number;
  onJump: (index: number) => void;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem("anur.outline") !== "closed";
    } catch {
      return true;
    }
  });
  if (!sections) return null;
  return (
    <details
      className="left-outline"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        try {
          window.localStorage.setItem("anur.outline", now ? "open" : "closed");
        } catch {
          // A remembered fold is a nicety.
        }
      }}
    >
      <summary className="left-outline-head">Outline</summary>
      <Outline sections={sections} current={current} onJump={onJump} />
    </details>
  );
}

/** 5. Right sidebar: Think, on the section in focus. */
export function RightSidebar({
  hidden,
  think,
}: {
  hidden: boolean;
  /** Think for a doc; for the system, a slot its map fills with what's clicked. */
  think: React.ReactNode;
}) {
  return (
    <aside className="right-sidebar" aria-label="Think" hidden={hidden}>
      <div className="right-main">{think}</div>
    </aside>
  );
}

const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: "Saved",
  editing: "Edited",
  saving: "Saving…",
  "changed-outside": "Not saved: changed outside Anur",
  failed: "Not saved",
};

/** Whether the person's agent is connected; it connects when a thread first needs it. */
function AgentState() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  useEffect(() => {
    let shown: string | null = null;
    void anur.call("agent:status", { connect: false }).then((s) => {
      shown = s.id;
      setStatus(s);
    });
    // The default agent's status; another agent's doesn't replace it here.
    return anur.on("agent:status", (s) => {
      if (shown === null || s.id === shown) setStatus(s);
    });
  }, []);
  const on = status?.connected === true;
  return (
    <span className="status-item" title={status?.reason ?? undefined}>
      <span className={`dot ${on ? "on" : "off"}`} aria-hidden="true" />
      {on
        ? `${AGENTS[status.id].name} connected`
        : status?.connected === false
          ? "Agent not connected"
          : "Agent connects with the first thread"}
    </span>
  );
}

/** 6. Status bar: agent connection, saved state, thread count. */
export function StatusBar({
  version,
  folder,
  docMode,
  saveStatus,
  source,
  onToggleSource,
  threads,
}: {
  /** The open doc's threads and the tokens they've used (4.10); null with no doc open. */
  threads: { count: number; tokens: number } | null;
  version: string | null;
  folder: FolderState | null;
  docMode: "editable" | "read-only" | "plain-text" | null;
  saveStatus: SaveStatus | null;
  source: boolean;
  onToggleSource: () => void;
}) {
  return (
    <footer className="status-bar" aria-label="Status">
      <AgentState />
      <span className="status-item">
        {docMode === "editable"
          ? SAVE_LABELS[saveStatus ?? "saved"]
          : docMode === "read-only"
            ? "Read-only"
            : docMode === "plain-text"
              ? "Plain text, read-only"
              : folder?.mode === "read-only"
                ? "Read-only folder"
                : "Nothing to save"}
      </span>
      {folder?.cloud ? (
        <span className="status-item" title={cloudSummary(folder)?.join("\n")}>
          {PROVIDERS[folder.cloud]}
          {folder.offloaded.length > 0
            ? ` · ${String(folder.offloaded.length)} not downloaded`
            : ""}
        </span>
      ) : null}
      <PluginStatuses folder={folder?.path ?? null} />
      <span className="status-spacer" />
      {docMode && docMode !== "plain-text" ? (
        <button
          type="button"
          className="status-item status-button"
          title="Switch between live preview and source (⌘E)"
          onClick={onToggleSource}
        >
          {source ? "Source" : "Live preview"}
        </button>
      ) : null}
      {threads ? (
        <span className="status-item">
          {threads.count === 0
            ? "No threads"
            : threads.count === 1
              ? "1 thread"
              : `${String(threads.count)} threads`}
        </span>
      ) : null}
      <UpdatePill />
      {version ? <VersionItem version={version} /> : null}
    </footer>
  );
}

/** Each plugin's item in the status bar, such as Git's sync state. */
function PluginStatuses({ folder }: { folder: string | null }) {
  const items = usePluginStatuses(folder);
  return (
    <>
      {items.map(([plugin, status]) => (
        <PluginStatusItem key={plugin} plugin={plugin} status={status} />
      ))}
    </>
  );
}
