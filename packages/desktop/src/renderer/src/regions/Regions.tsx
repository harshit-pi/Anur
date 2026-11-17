import { useState, type ReactNode } from "react";
import type { SectionTree } from "@anur/core";
import type { FolderState } from "../../../shared/ipc-contract.ts";
import { FileTree } from "./FileTree.tsx";
import {
  BackIcon,
  ChevronDownIcon,
  FolderIcon,
  ForwardIcon,
  LinkIcon,
  MoreIcon,
  PluginsIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "./Icons.tsx";

/**
 * The seven regions, fixed from day 1 (FR10). Plugins and later groups add
 * to them, never new ones. Each is empty until the group that fills it.
 */

/** 1. Ribbon: Files, Search, Plugins, Settings. */
export function Ribbon({ onCommand }: { onCommand: () => void }) {
  return (
    <nav className="ribbon" aria-label="Ribbon">
      <button className="ribbon-button active" type="button" aria-label="Files" title="Files">
        <FolderIcon />
      </button>
      <button
        className="ribbon-button"
        type="button"
        aria-label="Search"
        title="Search"
        onClick={onCommand}
      >
        <SearchIcon />
      </button>
      <div className="ribbon-spacer" />
      <button className="ribbon-button" type="button" aria-label="Plugins" title="Plugins">
        <PluginsIcon />
      </button>
      <button className="ribbon-button" type="button" aria-label="Settings" title="Settings">
        <SettingsIcon />
      </button>
    </nav>
  );
}

/** 2. Left sidebar: the folder's files, or search. */
export function LeftSidebar({
  folder,
  selected,
  onSelect,
}: {
  folder: FolderState | null;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  if (!folder) {
    return (
      <aside className="left-sidebar" aria-label="Files">
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
    <aside className="left-sidebar" aria-label="Files">
      <p className="sidebar-title truncate" title={folder.path}>
        {folder.name}
      </p>
      <FileTree
        docs={folder.docs}
        offloaded={folder.offloaded}
        selected={selected}
        onSelect={onSelect}
      />
      {folder.truncated ? (
        <p className="quiet">This folder has more files than Anur lists; some are left out.</p>
      ) : null}
    </aside>
  );
}

/** 3. Tab bar: tabs, then Page and Map, then Ask. */
export function TabBar() {
  return (
    <header className="tab-bar" aria-label="Tabs">
      <div className="tabs" role="tablist" aria-label="Open docs">
        <span className="quiet tab-empty">No docs open</span>
        <button
          className="icon-button"
          type="button"
          aria-label="New tab"
          title="New tab (⌘T)"
          disabled
        >
          <PlusIcon />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="List all tabs"
          title="List all tabs"
          disabled
        >
          <ChevronDownIcon />
        </button>
      </div>
      <div className="segmented" role="radiogroup" aria-label="View">
        <button
          type="button"
          role="radio"
          aria-checked="true"
          className="segment selected"
          disabled
        >
          Page
        </button>
        <button type="button" role="radio" aria-checked="false" className="segment" disabled>
          Map
        </button>
      </div>
      <button className="ask-button" type="button" disabled title="Ask about the whole doc">
        Ask
      </button>
    </header>
  );
}

const PROVIDERS: Record<NonNullable<FolderState["cloud"]>, string> = {
  icloud: "iCloud Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  "google-drive": "Google Drive",
  cloud: "a cloud folder",
};

/** Notices about where the folder lives and what its sync service left behind. */
function FolderNotices({
  folder,
  onMerge,
}: {
  folder: FolderState;
  onMerge: (copy: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  return (
    <>
      {folder.cloud && !dismissed ? (
        <div className="notice" role="status">
          <span>
            This folder syncs through {PROVIDERS[folder.cloud]}. Anur keeps its caches and its lock
            on this Mac, outside the folder.
            {folder.offloaded.length > 0
              ? ` ${String(folder.offloaded.length)} docs are still in iCloud; Anur downloads each one before opening it.`
              : ""}
            {folder.gitInCloud
              ? " It is also a git repo: sync can break git's lock files, so a repo is safer outside a synced folder."
              : ""}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss"
            onClick={() => {
              setDismissed(true);
            }}
          >
            ×
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
}: {
  folder: FolderState | null;
  selected: string | null;
  /** The open doc's page, once it has loaded. */
  page: ReactNode;
  /** What is happening while a doc loads, such as a download from iCloud. */
  opening: string | null;
  docNote: string | null;
  docError: string | null;
  onOpenFolder: () => void;
  onMerge: (copy: string) => void;
}) {
  return (
    <main className="center">
      <div className="path-row">
        <button className="icon-button" type="button" aria-label="Back" disabled>
          <BackIcon />
        </button>
        <button className="icon-button" type="button" aria-label="Forward" disabled>
          <ForwardIcon />
        </button>
        <span className="path quiet truncate" title={selected ?? undefined}>
          {selected ? selected.replace(/\.md$/i, "").split("/").join(" / ") : "No doc"}
        </span>
        <div className="path-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Copy a link to this section"
            disabled
          >
            <LinkIcon />
          </button>
          <button className="icon-button" type="button" aria-label="More" disabled>
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
}: {
  sections: SectionTree | null;
  onJump: (index: number) => void;
}) {
  const [tab, setTab] = useState<(typeof RIGHT_TABS)[number]>("Outline");
  return (
    <aside className="right-sidebar" aria-label="Section details">
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
        ) : (
          <p className="quiet">{RIGHT_EMPTY[tab]}</p>
        )}
      </div>
    </aside>
  );
}

/** 6. Status bar: agent connection, saved state, thread count. */
export function StatusBar({
  version,
  folder,
  docMode,
  source,
  onToggleSource,
}: {
  version: string | null;
  folder: FolderState | null;
  docMode: "editable" | "read-only" | "plain-text" | null;
  source: boolean;
  onToggleSource: () => void;
}) {
  return (
    <footer className="status-bar" aria-label="Status">
      <span className="status-item">
        <span className="dot off" aria-hidden="true" />
        Agent not connected
      </span>
      <span className="status-item">
        {docMode === "editable"
          ? "Viewing only: editing arrives with autosave"
          : docMode === "read-only"
            ? "Read-only"
            : docMode === "plain-text"
              ? "Plain text, read-only"
              : folder?.mode === "read-only"
                ? "Read-only folder"
                : "Nothing to save"}
      </span>
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
