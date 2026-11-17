import { useState } from "react";
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
            <strong>{c.copy}</strong> looks like a {c.service === "icloud" ? "iCloud" : "Dropbox"}{" "}
            conflict copy of {c.original}.
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
  onOpenFolder,
  onMerge,
}: {
  folder: FolderState | null;
  selected: string | null;
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
      {folder ? (
        <div className="page-empty">
          <h1>{selected ? "Docs open in the next step" : "Pick a doc"}</h1>
          <p>
            {selected
              ? "The editor arrives with task 2.5; for now Anur lists the folder's files."
              : `${String(folder.docs.length)} Markdown files in ${folder.name}. Pick one on the left.`}
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

/** 5. Right sidebar: Outline, Think and History. */
export function RightSidebar() {
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
      <p className="quiet" role="tabpanel">
        {RIGHT_EMPTY[tab]}
      </p>
    </aside>
  );
}

/** 6. Status bar: agent connection, saved state, thread count. */
export function StatusBar({
  version,
  folder,
}: {
  version: string | null;
  folder: FolderState | null;
}) {
  return (
    <footer className="status-bar" aria-label="Status">
      <span className="status-item">
        <span className="dot off" aria-hidden="true" />
        Agent not connected
      </span>
      <span className="status-item">
        {folder?.mode === "read-only" ? "Read-only folder" : "Nothing to save"}
      </span>
      <span className="status-spacer" />
      <span className="status-item">No threads</span>
      {version ? <span className="status-item quiet">Anur {version}</span> : null}
    </footer>
  );
}
