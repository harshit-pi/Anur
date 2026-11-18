import { useEffect, useState } from "react";
import type { FolderState, UpdateState } from "../../../shared/ipc-contract.ts";
import { AGENTS, AGENT_IDS, type AgentId } from "../../../shared/agents.ts";
import type { AgentStatus } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
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

type MainSettings = {
  sectionHistory: boolean;
  commitAnur: boolean | null;
  defaultAgent: AgentId;
  autoApply: boolean;
};

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

/** Where updates stand, with Check now, Download or Restart, and the automatic switch. */
function UpdateRows() {
  const [s, setS] = useState<{ state: UpdateState; version: string; auto: boolean } | null>(null);
  useEffect(() => {
    void anur.call("update:status", {}).then(setS);
    return anur.on("app:update-state", (state) => {
      setS((old) => (old ? { ...old, state } : old));
    });
  }, []);
  if (!s) return null;
  const { state, version, auto } = s;
  const off = state.kind === "off";
  const at = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const detail =
    state.kind === "off"
      ? "Anur Dev doesn't update itself. The Anur you install from the download link does."
      : state.kind === "idle"
        ? `Anur ${version} is up to date.${state.checkedAt ? ` Checked at ${at(state.checkedAt)}.` : ""}`
        : state.kind === "checking"
          ? "Checking for a new version…"
          : state.kind === "available"
            ? `Anur ${state.version} is available. You're on ${version}.`
            : state.kind === "downloading"
              ? `Downloading Anur ${state.version}… ${String(state.percent)}%`
              : state.kind === "ready"
                ? `Anur ${state.version} is ready. Restart to use it, or it installs when you quit.`
                : `Couldn't check for updates: ${state.reason}.`;
  const action =
    state.kind === "idle" || state.kind === "error"
      ? { label: "Check now", run: () => void anur.call("update:check", {}) }
      : state.kind === "available"
        ? { label: "Download", run: () => void anur.call("update:download", {}) }
        : state.kind === "ready"
          ? { label: "Restart", run: () => void anur.call("update:restart", {}) }
          : null;
  return (
    <>
      <Row title="Updates" detail={detail}>
        {action ? (
          <button type="button" className="settings-button" onClick={action.run}>
            {action.label}
          </button>
        ) : null}
      </Row>
      <Row
        title="Install updates automatically"
        detail="New versions download in the background and install when you quit or restart. Off, Anur only tells you one is available."
      >
        <Switch
          on={auto}
          label="Install updates automatically"
          disabled={off}
          onChange={(on) => {
            void anur.call("update:set-auto", { auto: on }).then((r) => {
              setS((old) => (old ? { ...old, auto: r.auto } : old));
            });
          }}
        />
      </Row>
    </>
  );
}

/** Which app opens .md files from Finder, with a button to make it Anur. */
function OpenerRow() {
  const [s, setS] = useState<{ can: boolean; isAnur: boolean; current: string | null } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const load = () => {
    void anur.call("opener:status", {}).then(setS);
  };
  useEffect(load, []);
  return (
    <Row
      title="Open Markdown files with Anur"
      detail={
        failed
          ? "macOS didn't allow the change."
          : !s
            ? "Checking…"
            : !s.can
              ? "Only the installed Anur app can open .md files from Finder."
              : s.isAnur
                ? "Anur opens .md files from Finder, in the folder they belong to."
                : `${s.current ?? "No app"} opens .md files from Finder now.`
      }
    >
      {s?.can && !s.isAnur ? (
        <button
          type="button"
          className="settings-button"
          onClick={() => {
            setFailed(false);
            void anur.call("opener:act", { action: "make" }).then((r) => {
              if (!r.ok) setFailed(true);
              load();
            });
          }}
        >
          Use Anur
        </button>
      ) : null}
    </Row>
  );
}

/** Anur in the person's Claude Code (6.2): added or not, with Add, Update and Remove. */
function SkillRow() {
  const [s, setS] = useState<{ added: boolean; claude: boolean; current: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    void anur.call("skill:status", {}).then(setS);
  };
  useEffect(load, []);
  const act = (action: "add" | "update" | "remove") => {
    setBusy(true);
    setError(null);
    void anur.call("skill:act", { action }).then((r) => {
      setBusy(false);
      if (r.kind === "failed") setError(r.reason);
      load();
    });
  };
  return (
    <Row
      title="Use Anur from Claude Code"
      detail={
        error ??
        (!s
          ? "Checking…"
          : !s.claude
            ? "Claude Code isn't on this computer."
            : !s.added
              ? "Adds /anur to Claude Code: /anur doc turns a chat into a doc here."
              : s.current
                ? "Added: /anur doc, /anur new and /anur open work in Claude Code. Anur keeps them up to date."
                : "Added, but out of date: Anur updates it on its next launch, or now.")
      }
    >
      {s?.claude ? (
        <div className="settings-actions">
          {!s.added ? (
            <button
              type="button"
              className="think-button primary"
              disabled={busy}
              onClick={() => {
                act("add");
              }}
            >
              Add
            </button>
          ) : (
            <>
              {!s.current ? (
                <button
                  type="button"
                  className="think-button primary"
                  disabled={busy}
                  onClick={() => {
                    act("update");
                  }}
                >
                  Update
                </button>
              ) : null}
              <button
                type="button"
                className="think-button"
                disabled={busy}
                onClick={() => {
                  act("remove");
                }}
              >
                Remove
              </button>
            </>
          )}
        </div>
      ) : null}
    </Row>
  );
}

export function Settings({
  section,
  onSection,
  onClose,
  folder,
  onOpenFolder,
  onTour,
}: {
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;
  folder: FolderState | null;
  onOpenFolder: () => void;
  /** Show the tour again; null while no doc is open for it to point at. */
  onTour: (() => void) | null;
}) {
  const [main, setMain] = useState<MainSettings | null>(null);
  const [theme, setTheme] = useState<ThemePref>(() => loadTheme(window.localStorage));

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

  const [status, setStatus] = useState<AgentStatus | null>(null);
  useEffect(() => {
    if (!main) return;
    void anur.call("agent:status", { connect: false, agent: main.defaultAgent }).then(setStatus);
    return anur.on("agent:status", (s) => {
      if (s.id === main.defaultAgent) setStatus(s);
    });
  }, [main]);

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
            <UpdateRows />
            <OpenerRow />
            <Row
              title="Tour"
              detail={
                onTour
                  ? "Five short steps through what Anur can do. It showed once on your first doc."
                  : "Open a doc first: the tour points at parts of it."
              }
            >
              <button
                type="button"
                className="settings-button"
                disabled={!onTour}
                onClick={onTour ?? undefined}
              >
                Show the tour
              </button>
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
              Anur runs your own agent, with your sign-in, settings and plugins. A thread keeps its
              section's text and its chat in Anur, so you can move it to another agent and it
              carries on from there.
            </p>
            <Row
              title="Default agent"
              detail="New threads run on this agent. Each thread can switch in the Think panel."
            >
              <select
                className="settings-select"
                aria-label="Default agent"
                value={main?.defaultAgent ?? "claude-code"}
                disabled={!main}
                onChange={(e) => {
                  const next = AGENT_IDS.find((id) => id === e.target.value);
                  if (next) change({ defaultAgent: next });
                }}
              >
                {AGENT_IDS.map((id) => (
                  <option key={id} value={id} disabled={!AGENTS[id].runsThreads}>
                    {AGENTS[id].runsThreads ? AGENTS[id].name : `${AGENTS[id].name} (not yet)`}
                  </option>
                ))}
              </select>
            </Row>
            <Row
              title="Use agents' edits as they land"
              detail="An agent's edit changes the doc at once, instead of waiting as a proposal for you to use. Each is noted in its thread, with Undo; edits that clash with your typing stay proposals. Options are always yours to pick."
            >
              <Switch
                on={main?.autoApply ?? false}
                label="Use agents' edits as they land"
                onChange={(on) => {
                  change({ autoApply: on });
                }}
              />
            </Row>
            {/* Then each agent on its own: how it's connected, and what Anur adds to it. */}
            {AGENT_IDS.map((id) => (
              <section key={id} className="settings-group" aria-label={AGENTS[id].name}>
                <h3>{AGENTS[id].name}</h3>
                {!AGENTS[id].runsThreads ? (
                  <Row title="Connection" detail={AGENTS[id].why ?? ""}>
                    <span className="settings-status">Not yet</span>
                  </Row>
                ) : (
                  <Row
                    title="Connection"
                    detail={
                      id !== main?.defaultAgent
                        ? "Connects when a thread on it first needs it."
                        : status?.connected === true
                          ? `Connected: version ${status.agent?.agent ?? "unknown"}, through its ACP adapter ${status.agent?.adapter ?? ""}.`
                          : status?.connected === false
                            ? (status.reason ?? "Not connected.")
                            : "Connects when a thread first needs it."
                    }
                  >
                    <span className="settings-status">
                      {id !== main?.defaultAgent
                        ? "Not started"
                        : status?.connected === true
                          ? "Connected"
                          : status?.connected === false
                            ? "Not connected"
                            : "Not started"}
                    </span>
                  </Row>
                )}
                {id === "claude-code" ? <SkillRow /> : null}
              </section>
            ))}
          </>
        );
      case "core":
        return (
          <>
            <h2>Core plugins</h2>
            <p className="settings-lede">
              What every doc needs: the page and its map, and threads beside them. These two are
              always on; the rest can be turned off.
            </p>
            <Row
              title="Page and map"
              detail="Every doc as a page and as a map drawn from its headings: boxes to move, add, link and open."
            >
              <span className="settings-status">Always on</span>
            </Row>
            <Row
              title="Think"
              detail="Threads on each section, each its own chat with your agent: options to pick, edits to use, its inputs kept."
            >
              <span className="settings-status">Always on</span>
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
