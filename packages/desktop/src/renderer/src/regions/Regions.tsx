import { useState } from "react";
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
export function LeftSidebar() {
  return (
    <aside className="left-sidebar" aria-label="Files">
      <p className="sidebar-title">No folder open</p>
      <p className="quiet">
        Open a folder of Markdown files, such as a repo or an Obsidian vault. Anur works on the
        files as they are.
      </p>
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

/** 4. Center: the page or the map, per tab, under the path row. */
export function Center() {
  return (
    <main className="center">
      <div className="path-row">
        <button className="icon-button" type="button" aria-label="Back" disabled>
          <BackIcon />
        </button>
        <button className="icon-button" type="button" aria-label="Forward" disabled>
          <ForwardIcon />
        </button>
        <span className="path quiet">No doc</span>
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
      <div className="page-empty">
        <h1>Open a folder to start</h1>
        <p>
          Anur reads the Markdown files already in it. Your docs stay plain files that open in any
          editor.
        </p>
      </div>
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
export function StatusBar({ version }: { version: string | null }) {
  return (
    <footer className="status-bar" aria-label="Status">
      <span className="status-item">
        <span className="dot off" aria-hidden="true" />
        Agent not connected
      </span>
      <span className="status-item">Nothing to save</span>
      <span className="status-spacer" />
      <span className="status-item">No threads</span>
      {version ? <span className="status-item quiet">Anur {version}</span> : null}
    </footer>
  );
}
