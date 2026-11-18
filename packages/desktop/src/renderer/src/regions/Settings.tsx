import { useEffect, useState } from "react";
import type { FolderState, UpdateState } from "../../../shared/ipc-contract.ts";
import { AGENTS, AGENT_IDS, type AgentId } from "../../../shared/agents.ts";
import type { AgentStatus } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import { useFeatures } from "../features.ts";
import { FEATURES } from "../../../shared/features.ts";
import { CloseIcon } from "./Icons.tsx";
import { type ThemePref, applyTheme, loadTheme, saveTheme } from "./theme-pref.ts";
import { type PageFont, applyPageFont, loadPageFont, savePageFont } from "./font-pref.ts";

/**
 * Settings (task 2.25), from the gear, the plugins icon or ⌘,. Laid out as
 * Mock 7. What Anur can do now is live; what arrives with a later group
 * says which, so nothing on this screen is a switch that does nothing.
 */

export type SettingsSection = "general" | "appearance" | "agent" | "storage" | "core" | "community";

const SECTIONS: { id: SettingsSection; label: string; group?: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "agent", label: "Agent" },
  { id: "storage", label: "Storage" },
  { id: "core", label: "Core plugins", group: "Plugins" },
  { id: "community", label: "Community plugins" },
];

type MainSettings = {
  commitAnur: boolean | null;
  defaultAgent: AgentId;
  autoApply: boolean;
  name: string;
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

/** Live sessions and the agents' memory, with the limit past which idle ones close (13.3, 13.4). */
function SessionsRow() {
  const [s, setS] = useState<{ live: number; limit: number; memoryMb: number | null } | null>(null);
  useEffect(() => {
    const load = () => void anur.call("agent:sessions", {}).then(setS);
    load();
    const every = setInterval(load, 5000);
    return () => {
      clearInterval(every);
    };
  }, []);
  const memory =
    s?.memoryMb == null
      ? ""
      : s.memoryMb >= 1024
        ? `, using ${(s.memoryMb / 1024).toFixed(1)} GB`
        : `, using ${String(s.memoryMb)} MB`;
  return (
    <Row
      title="Live sessions"
      detail={
        s
          ? `${s.live === 0 ? "None live now" : `${String(s.live)} live now${memory}`}. Past the limit, sessions idle for a few minutes close; each reopens with its chat when its thread is next used.`
          : "Checking…"
      }
    >
      <select
        className="settings-select"
        aria-label="Live session limit"
        value={s?.limit ?? 8}
        disabled={!s}
        onChange={(e) => {
          void anur.call("agent:set-session-limit", { limit: Number(e.target.value) }).then(setS);
        }}
      >
        {[2, 4, 6, 8, 12, 16, 20].map((n) => (
          <option key={n} value={n}>
            {`Up to ${String(n)}`}
          </option>
        ))}
      </select>
    </Row>
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

const sizeOf = (bytes: number) =>
  bytes < 1024
    ? `${String(bytes)} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

type Storage = {
  kinds: { kind: string; bytes: number; files: number }[];
  cleanable: { count: number; bytes: number };
  blockedBy: { openedAt: string | null }[];
  attachments: { path: string; bytes: number }[];
};

/** Storage (11.5, 11.6): what `.anur/` holds, Clean up, and attachments nothing uses. */
function StoragePane({ folder }: { folder: FolderState | null }) {
  const [s, setS] = useState<Storage | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    setS(null);
    void anur.call("storage:read", {}).then(setS);
  }, [folder?.path, n]);
  if (folder?.mode !== "writable")
    return <Row title="Storage" detail="Open a folder Anur can write to." />;
  if (!s) return <p className="settings-row-detail">Reading .anur/…</p>;
  const total = s.kinds.reduce((t, k) => t + k.bytes, 0);
  const since = s.blockedBy
    .map((b) => (b.openedAt ? new Date(b.openedAt).toLocaleDateString() : null))
    .filter((x) => x !== null);
  return (
    <>
      <Row
        title="What .anur/ holds"
        detail={`${sizeOf(total)} of threads, history and what threads read, kept beside your files.`}
      />
      <table className="settings-storage">
        <tbody>
          {s.kinds.map((k) => (
            <tr key={k.kind}>
              <td>{k.kind.charAt(0).toUpperCase() + k.kind.slice(1)}</td>
              <td>{sizeOf(k.bytes)}</td>
              <td className="quiet">
                {String(k.files)} {k.files === 1 ? "file" : "files"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Row
        title="Clean up"
        detail={
          s.blockedBy.length > 0
            ? `Another device has this folder open, or didn't quit cleanly${since.length ? ` (opened ${since.join(", ")})` : ""}. Quit Anur there first, so nothing it is still writing goes.`
            : s.cleanable.count === 0
              ? "Nothing to clean: every snapshot is in use or newer than 30 days."
              : `${String(s.cleanable.count)} ${s.cleanable.count === 1 ? "snapshot" : "snapshots"} nothing points to, unused for 30 days: ${sizeOf(s.cleanable.bytes)}.`
        }
      >
        <button
          type="button"
          className="settings-button"
          disabled={s.blockedBy.length > 0 || s.cleanable.count === 0}
          onClick={() => {
            void anur.call("storage:clean", {}).then((r) => {
              setNote(
                r.kind === "ok"
                  ? `Removed ${String(r.removed)} ${r.removed === 1 ? "snapshot" : "snapshots"}.`
                  : r.reason,
              );
              setN((x) => x + 1);
            });
          }}
        >
          Clean up
        </button>
      </Row>
      {note ? <p className="settings-row-detail">{note}</p> : null}
      <Row
        title="Unused attachments"
        detail={
          s.attachments.length === 0
            ? "None: every image and attached file is linked or used."
            : "Images and attached files no doc links and no thread uses. Each goes to the Trash only when you say."
        }
      />
      {s.attachments.length > 0 ? (
        <ul className="settings-attachments">
          {s.attachments.map((a) => (
            <li key={a.path}>
              <span className="settings-attachment-path">{a.path}</span>
              <span className="quiet">{sizeOf(a.bytes)}</span>
              <button
                type="button"
                className="settings-button"
                onClick={() => {
                  void anur.call("attachment:trash", { path: a.path }).then(() => {
                    setN((x) => x + 1);
                  });
                }}
              >
                Move to Trash
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
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
  const features = useFeatures();
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
  const [pageFont, setPageFont] = useState<PageFont>(() => loadPageFont(window.localStorage));
  const pickPageFont = (f: PageFont) => {
    setPageFont(f);
    savePageFont(window.localStorage, f);
    applyPageFont(f);
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
              title="Your name"
              detail="Shown on threads you start, to others who open a shared folder. Empty uses git's name, else your Mac account's."
            >
              <input
                key={main?.name ?? ""}
                className="settings-input"
                aria-label="Your name"
                defaultValue={main?.name ?? ""}
                maxLength={80}
                onBlur={(e) => {
                  if (e.currentTarget.value.trim() !== (main?.name ?? ""))
                    void anur.call("settings:set", { name: e.currentTarget.value }).then(setMain);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
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
      case "storage":
        return (
          <>
            <h2>Storage</h2>
            <StoragePane folder={folder} />
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
            <Row
              title="Page font"
              detail="The font docs and agents' replies are read in. Serif is Source Serif, close to Claude's; Sans is the app's; System is the Mac's."
            >
              <div className="segmented" role="radiogroup" aria-label="Page font">
                {(["serif", "sans", "system"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={pageFont === f}
                    className={`segmented-option font-option-${f}`}
                    onClick={() => {
                      pickPageFont(f);
                    }}
                  >
                    {f === "serif" ? "Serif" : f === "sans" ? "Sans" : "System"}
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
            <SessionsRow />
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
              always on; turn the rest off and everything they add goes, in every window.
            </p>
            {FEATURES.map((f) =>
              f.always ? (
                <Row key={f.id} title={f.name} detail={f.what}>
                  <span className="settings-status">Always on</span>
                </Row>
              ) : (
                <Row key={f.id} title={f.name} detail={f.what}>
                  <Switch
                    on={features[f.id]}
                    label={f.name}
                    onChange={(on) => {
                      void anur.call("features:set", { id: f.id, on });
                    }}
                  />
                </Row>
              ),
            )}
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
