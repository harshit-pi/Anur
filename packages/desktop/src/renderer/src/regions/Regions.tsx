import { Fragment, useEffect, useState, type ReactNode } from "react";
import { crumbs } from "../layout/path-row.ts";
import type { SectionTree } from "@anur/core";
import type { AgentStatus, FolderState } from "../../../shared/ipc-contract.ts";
import { AGENTS } from "../../../shared/agents.ts";
import { anur } from "../bridge.ts";
import { FileTree } from "./FileTree.tsx";
import {
  BackIcon,
  CloseIcon,
  CollapseAllIcon,
  FolderIcon,
  ForwardIcon,
  LinkIcon,
  MoreIcon,
  PluginsIcon,
  SearchIcon,
  SettingsIcon,
} from "./Icons.tsx";
import type { SaveStatus } from "../editor/autosave.ts";
import { PROVIDERS, cloudSummary, markNoticeSeen, noticeSeen } from "./cloud-notice.ts";

/**
 * The seven regions, fixed from day 1 (FR10). Plugins and later groups add
 * to them, never new ones. Each is empty until the group that fills it.
 */

/** 1. Ribbon: Files, Search, Plugins, Settings. */
export function Ribbon({
  filesOpen,
  onFiles,
  searchOpen,
  onSearch,
  onSettings,
  onPlugins,
}: {
  filesOpen: boolean;
  onFiles: () => void;
  searchOpen: boolean;
  onSearch: () => void;
  onSettings: () => void;
  onPlugins: () => void;
}) {
  return (
    <nav className="ribbon" aria-label="Ribbon">
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

/** 2. Left sidebar: the folder's files. */
export function LeftSidebar({
  folder,
  selected,
  onSelect,
  hidden,
  reveal,
}: {
  folder: FolderState | null;
  selected: string | null;
  onSelect: (path: string, inNewTab: boolean) => void;
  /** Collapsed: kept mounted, so folders stay expanded as they were. */
  hidden: boolean;
  /** Changes whenever a tab is pressed or a doc comes into focus: reveal it in the tree. */
  reveal: number;
}) {
  const [collapse, setCollapse] = useState(0);
  if (!folder) {
    return (
      <aside className="left-sidebar" aria-label="Files" hidden={hidden}>
        <p className="sidebar-title truncate" title="No folder open">
          No folder open
        </p>
        <p className="quiet">
          Open a folder of Markdown files, such as a repo or an Obsidian vault. Anur works on the
          files as they are.
        </p>
      </aside>
    );
  }
  return (
    <aside className="left-sidebar" aria-label="Files" hidden={hidden}>
      <div className="sidebar-head">
        <p className="sidebar-title truncate" title={folder.path}>
          {folder.name}
        </p>
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
      <FileTree
        docs={folder.docs}
        offloaded={folder.offloaded}
        selected={selected}
        onSelect={onSelect}
        reveal={reveal}
        collapse={collapse}
      />
      {folder.truncated ? (
        <p className="quiet">This folder has more files than Anur lists; some are left out.</p>
      ) : null}
    </aside>
  );
}

/** Notices about where the folder lives and what its sync service left behind. */
function FolderNotices({
  folder,
  onMerge,
}: {
  folder: FolderState;
  onMerge: (copy: string) => void;
}) {
  // Once per folder: dismissed, it stays dismissed on this Mac, and the
  // status bar's cloud item carries the same words.
  const [dismissed, setDismissed] = useState(() => noticeSeen(window.localStorage, folder.path));
  const summary = cloudSummary(folder);
  return (
    <>
      {summary && !dismissed ? (
        <div className="notice" role="status">
          <span>{summary.join(" ")}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss"
            title="Dismiss; the status bar keeps this"
            onClick={() => {
              markNoticeSeen(window.localStorage, folder.path);
              setDismissed(true);
            }}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
      {folder.conflicts.map((c) => (
        <div key={c.copy} className="banner conflict" role="status">
          <span className="truncate" title={c.copy}>
            <strong>{c.copy}</strong> looks like{" "}
            {c.service === "icloud" ? "an iCloud" : "a Dropbox"} conflict copy of {c.original}.
          </span>
          <button
            type="button"
            className="ask-button"
            onClick={() => {
              onMerge(c.copy);
            }}
          >
            Review merge
          </button>
        </div>
      ))}
    </>
  );
}

/** 4. Center: the page or the map, per tab, under the path row. */
export function Center({
  folder,
  selected,
  page,
  opening,
  docNote,
  docError,
  onOpenFolder,
  onMerge,
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
  /** What is happening while a doc loads, such as a download from iCloud. */
  opening: string | null;
  docNote: string | null;
  docError: string | null;
  onOpenFolder: () => void;
  onMerge: (copy: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <main className="center">
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
          {selected ? (
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
                  title={
                    c.lists ? `What's in ${c.lists}` : `What's in ${folder?.name ?? "the folder"}`
                  }
                  onClick={() => {
                    onCrumb(c.lists);
                  }}
                >
                  {c.label}
                </button>
              </Fragment>
            ))
          ) : (
            <span className="quiet">No doc</span>
          )}
        </nav>
        <div className="path-actions">
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
      {folder ? <FolderNotices key={folder.path} folder={folder} onMerge={onMerge} /> : null}
      {folder?.mode === "read-only" ? (
        <div className="banner" role="status">
          <strong>Read-only.</strong> {folder.reason}
        </div>
      ) : null}
      {docNote ? (
        <div className="banner" role="status">
          {docNote}
        </div>
      ) : null}
      {docError ? (
        <div className="banner" role="alert">
          {docError}
        </div>
      ) : null}
      {page ? (
        page
      ) : opening ? (
        <div className="page-empty">
          <p className="quiet">{opening}</p>
        </div>
      ) : folder ? (
        <div className="page-empty">
          <h1>Pick a doc</h1>
          <p>
            {`${String(folder.docs.length)} Markdown files in ${folder.name}. Pick one on the left.`}
          </p>
        </div>
      ) : (
        <div className="page-empty">
          <h1>Open a folder to start</h1>
          <p>
            Anur reads the Markdown files already in it. Your docs stay plain files that open in any
            editor.
          </p>
          <button className="primary-button" type="button" onClick={onOpenFolder}>
            Open folder <span className="kbd">⌘O</span>
          </button>
        </div>
      )}
    </main>
  );
}

const RIGHT_TABS = ["Outline", "Think", "History"] as const;
const RIGHT_EMPTY: Record<(typeof RIGHT_TABS)[number], string> = {
  Outline: "The open doc's headings show here.",
  Think: "Threads on the section you're in show here.",
  History: "Earlier versions of the section you're in show here.",
};

/** The open doc's headings, from the editor's own parse; a click scrolls the page there. */
function Outline({ sections, onJump }: { sections: SectionTree; onJump: (index: number) => void }) {
  const headed = sections.sections.filter((s) => s.headingRange);
  if (headed.length === 0) return <p className="quiet">This doc has no headings yet.</p>;
  return (
    <ul className="outline" aria-label="Outline">
      {headed.map((s) => (
        <li key={s.index}>
          <button
            type="button"
            className="tree-row"
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

/** 5. Right sidebar: Outline, Think and History. */
export function RightSidebar({
  sections,
  onJump,
  hidden,
  showThink,
  think,
}: {
  sections: SectionTree | null;
  onJump: (index: number) => void;
  hidden: boolean;
  /** Changes each time Think should come to the front. */
  showThink: number;
  /** The Think panel for the section the cursor is in (3.5). */
  think: React.ReactNode;
}) {
  const [tab, setTab] = useState<(typeof RIGHT_TABS)[number]>("Outline");
  // "Keep discussing" on a preview opens its thread here.
  useEffect(() => {
    if (showThink > 0) setTab("Think");
  }, [showThink]);
  return (
    <aside className="right-sidebar" aria-label="Section details" hidden={hidden}>
      <div className="segmented wide" role="tablist" aria-label="Section details">
        {RIGHT_TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "segment selected" : "segment"}
            title={t}
            onClick={() => {
              setTab(t);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="tab-panel">
        {tab === "Outline" && sections ? (
          <Outline sections={sections} onJump={onJump} />
        ) : tab === "Think" ? (
          think
        ) : (
          <p className="quiet">{RIGHT_EMPTY[tab]}</p>
        )}
      </div>
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
}: {
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
      <span className="status-item">No threads</span>
      {version ? <span className="status-item quiet">Anur {version}</span> : null}
    </footer>
  );
}
