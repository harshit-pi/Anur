import { useEffect, useState } from "react";
import type { FolderState } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import { isCollapsed, setCollapsed } from "../editor/properties/properties-widget.ts";
import { CloseIcon } from "./Icons.tsx";
import { type ThemePref, applyTheme, loadTheme, saveTheme } from "./theme-pref.ts";

/**
 * Settings (task 2.25), from the gear, the plugins icon or ⌘,. Laid out as
 * Mock 7. What Anur can do now is live; what arrives with a later group
 * says which, so nothing on this screen is a switch that does nothing.
 */

export type SettingsSection = "general" | "appearance" | "agent" | "core" | "community";

const SECTIONS: { id: SettingsSection; label: string; group?: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "agent", label: "Agent" },
  { id: "core", label: "Core plugins", group: "Plugins" },
  { id: "community", label: "Community plugins" },
];

type MainSettings = { sectionHistory: boolean; commitAnur: boolean | null };

function Switch({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange?: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange?.(!on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

function Row({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        <div className="settings-row-detail">{detail}</div>
      </div>
      {children}
    </div>
  );
}

export function Settings({
  section,
  onSection,
  onClose,
  folder,
  onOpenFolder,
}: {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  folder: FolderState | null;
  onOpenFolder: () => void;
}) {
  const [main, setMain] = useState<MainSettings | null>(null);
  const [theme, setTheme] = useState<ThemePref>(() => loadTheme(window.localStorage));
  const [folded, setFolded] = useState(isCollapsed);

  useEffect(() => {
    void anur.call("settings:get", {}).then(setMain);
  }, [folder?.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const change = (c: Partial<Omit<MainSettings, "commitAnur"> & { commitAnur: boolean }>) => {
    void anur.call("settings:set", c).then(setMain);
  };
  const pickTheme = (t: ThemePref) => {
    setTheme(t);
    saveTheme(window.localStorage, t);
    applyTheme(t);
  };

  const body = (() => {
    switch (section) {
      case "general":
        return (
          <>
            <h2>General</h2>
            <Row title="Folder" detail={folder ? folder.path : "No folder is open in this window."}>
              <button type="button" className="settings-button" onClick={onOpenFolder}>
                {folder ? "Open another folder…" : "Open a folder…"}
              </button>
            </Row>
            <Row
              title="Properties start folded"
              detail="The Properties box at the top of a doc opens folded away, in every doc and folder."
            >
              <Switch
                on={folded}
                label="Properties start folded"
                onChange={(on) => {
                  setFolded(on);
                  setCollapsed(on);
                }}
              />
            </Row>
            <Row
              title="Commit Anur's data with git"
              detail={
                folder?.mode === "writable"
                  ? "Threads, previews and history live in .anur/ in this folder. Off, git ignores it; on, it's committed with your files."
                  : "Needs a folder Anur can write to."
              }
            >
              <Switch
                on={main?.commitAnur === true}
                label="Commit Anur's data with git"
                disabled={!main || main.commitAnur === null || folder?.mode !== "writable"}
                onChange={(on) => {
                  change({ commitAnur: on });
                }}
              />
            </Row>
          </>
        );
      case "appearance":
        return (
          <>
            <h2>Appearance</h2>
            <Row title="Theme" detail="Light or dark, or follow the system.">
              <div className="segmented" role="radiogroup" aria-label="Theme">
                {(["system", "light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={theme === t}
                    className="segmented-option"
                    onClick={() => {
                      pickTheme(t);
                    }}
                  >
                    {t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
                  </button>
                ))}
              </div>
            </Row>
          </>
        );
      case "agent":
        return (
          <>
            <h2>Agent</h2>
            <p className="settings-lede">
              Anur runs your own Claude Code, with your sign-in, settings and plugins.
            </p>
            <Row
              title="Claude Code"
              detail="Not connected. Threads, previews and Apply arrive with group 3 of the build; until then the page, outline and history work on their own."
            >
              <span className="settings-status">Not connected</span>
            </Row>
          </>
        );
      case "core":
        return (
          <>
            <h2>Core plugins</h2>
            <p className="settings-lede">
              What every doc needs to keep the page clean and the brainstorm beside it. Each one can
              be turned off.
            </p>
            <Row
              title="Page and map"
              detail="Draws a map from each file's headings. The page opens first. The map arrives with group 7."
            >
              <Switch on label="Page and map" disabled />
            </Row>
            <Row
              title="Think on map"
              detail="Threads per section, each its own chat, with a preview to apply. Arrives with group 3."
            >
              <Switch on={false} label="Think on map" disabled />
            </Row>
            <Row
              title="Links as context"
              detail="A link to another section draws a line and adds its text to what the agent reads. Arrives with group 8."
            >
              <Switch on={false} label="Links as context" disabled />
            </Row>
            <Row
              title="Section history"
              detail="Keeps every version of a section's text: when a doc is first opened, each typing session, and changes made outside Anur. Off, no new versions are written."
            >
              <Switch
                on={main?.sectionHistory ?? true}
                label="Section history"
                disabled={!main}
                onChange={(on) => {
                  change({ sectionHistory: on });
                }}
              />
            </Row>
          </>
        );
      case "community":
        return (
          <>
            <h2>Community plugins</h2>
            <p className="settings-lede">Installed by you. Anur's core works without them.</p>
            <div className="settings-empty">
              No plugins yet. Plugins come once the engineering plugin is built, with an API
              modelled on Obsidian's: a plugin adds to the seven regions, never new ones.
            </div>
          </>
        );
    }
  })();

  return (
    <div
      className="palette-backdrop settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings" role="dialog" aria-modal="true" aria-label="Settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <div key={s.id}>
              {s.group ? <div className="settings-nav-group">{s.group}</div> : null}
              <button
                type="button"
                className="settings-nav-item"
                aria-current={section === s.id ? "page" : undefined}
                onClick={() => {
                  onSection(s.id);
                }}
              >
                {s.label}
              </button>
            </div>
          ))}
        </nav>
        <div className="settings-body">
          <button
            type="button"
            className="icon-button settings-close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
          {body}
        </div>
      </div>
    </div>
  );
}
