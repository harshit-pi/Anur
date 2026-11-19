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
import { type MapStyle, loadMapStyle, saveMapStyle } from "./map-style-pref.ts";

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
  { id: "community", label: "Plugins" },
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

/**
 * The task hooks in Claude Code (group 21): Anur's own plugin, added on the
 * person's click, that reports what each task changed in folders opened here.
 */
function TaskHooksRow() {
  const [s, setS] = useState<{ claude: boolean; added: boolean; current: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    void anur.call("taskHooks:status", {}).then(setS);
  }, [n]);
  if (!s) return null;
  const act = (action: "add" | "remove") => {
    setBusy(true);
    setNote(null);
    void anur.call("taskHooks:act", { action }).then((r) => {
      setBusy(false);
      if (r.kind === "failed") setNote(r.reason);
      setN((x) => x + 1);
    });
  };
  const detail = !s.claude
    ? "Claude Code isn't installed on this computer."
    : s.added
      ? "Added to Claude Code, for every folder on this Mac. After each task in a folder opened in Anur, a report of what it changed across the repos. Elsewhere it does nothing."
      : "Adds Anur's plugin to Claude Code, once for this Mac: after each task in a folder opened in Anur, a report of what it changed across the repos, ranked. Elsewhere it does nothing.";
  return (
    <>
      <Row title="Task reports in Claude Code, on this Mac" detail={detail}>
        {s.claude ? (
          <button
            type="button"
            className="settings-button"
            disabled={busy}
            onClick={() => {
              act(s.added ? "remove" : "add");
            }}
          >
            {busy ? "Working…" : s.added ? "Remove" : "Add to Claude Code"}
          </button>
        ) : null}
      </Row>
      {note ? <p className="settings-row-detail">{note}</p> : null}
    </>
  );
}

/** Plugins Anur ships, each with a switch for this window's folder (19.4). */
function PluginRows({ folder }: { folder: FolderState | null }) {
  const [list, setList] = useState<{ id: string; name: string; what: string; on: boolean }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    void anur.call("plugins:list", {}).then((r) => {
      setList(r.plugins);
    });
  }, [folder?.path, n]);
  return (
    <>
      {list.map((p) => (
        <Row
          key={p.id}
          title={p.name}
          detail={folder ? p.what : `${p.what} Open a folder to switch it on.`}
        >
          <Switch
            on={p.on}
            label={`${p.name} for this folder`}
            disabled={!folder}
            onChange={(on) => {
              setNote(null);
              void anur.call("plugins:set", { id: p.id, on }).then((r) => {
                if (r.kind === "refused") setNote(r.reason);
                setN((x) => x + 1);
                // Engineering on: show what it does at once, in the System tab.
                if (r.kind === "ok" && on && p.id === "engineering")
                  window.dispatchEvent(new CustomEvent("anur:engineering-on"));
              });
            }}
          />
        </Row>
      ))}
      {list.some((p) => p.id === "engineering") ? <TaskHooksRow /> : null}
      {note ? <p className="settings-row-detail">{note}</p> : null}
    </>
  );
}

type MarketData = Awaited<ReturnType<typeof anur.call<"market:list">>>;
type MarketPlugin = MarketData["installed"][number];

/**
 * Plugins (Plugins and Git mock): the ones installed, switched on per folder,
 * with their settings; and the feed's, to Install, which turns one on at once.
 * They update themselves unless that's switched off.
 */
function Market({ folder }: { folder: FolderState | null }) {
  const [tab, setTab] = useState<"installed" | "browse">("installed");
  const [data, setData] = useState<MarketData | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    void anur.call("market:list", { fresh: tab === "browse" }).then(setData);
  }, [folder?.path, n, tab]);
  const reload = () => {
    setN((x) => x + 1);
  };
  const q = query.trim().toLowerCase();
  const matches = (p: MarketPlugin) =>
    !q || p.name.toLowerCase().includes(q) || p.what.toLowerCase().includes(q);
  const installedIds = new Set((data?.installed ?? []).map((p) => p.id));
  return (
    <>
      <div className="market-tabs" role="tablist">
        {(["installed", "browse"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "on" : ""}
            onClick={() => {
              setTab(t);
            }}
          >
            {t === "installed" ? "Installed" : "Browse"}
          </button>
        ))}
      </div>
      {tab === "browse" ? (
        <>
          <input
            className="settings-input market-search"
            placeholder="Search plugins…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
          {data?.error ? <p className="settings-row-detail">{data.error}</p> : null}
          {(data?.feed ?? []).filter(matches).map((p) => (
            <Row
              key={p.id}
              title={`${p.name} · Standard`}
              detail={`${p.what} v${p.version}, signed by Anur.`}
            >
              {installedIds.has(p.id) ? (
                <span className="settings-row-detail">Installed</span>
              ) : (
                <button
                  type="button"
                  className="settings-button primary"
                  disabled={busy !== null}
                  onClick={() => {
                    setBusy(p.id);
                    setNote(null);
                    void anur
                      .call("market:install", { id: p.id })
                      .then((r) => {
                        if (r.error) setNote(r.error);
                        else setTab("installed");
                        reload();
                      })
                      .finally(() => {
                        setBusy(null);
                      });
                  }}
                >
                  {busy === p.id ? "Installing…" : "Install"}
                </button>
              )}
            </Row>
          ))}
          {data && !data.error && data.feed.filter(matches).length === 0 ? (
            <div className="settings-empty">No plugins match.</div>
          ) : null}
        </>
      ) : (
        <>
          <PluginRows folder={folder} />
          {(data?.installed ?? []).map((p) => (
            <InstalledPlugin
              key={p.id}
              plugin={p}
              folder={folder}
              on={data?.on.includes(p.id) ?? false}
              onChanged={reload}
              onNote={setNote}
            />
          ))}
          {data && data.installed.length === 0 ? (
            <div className="settings-empty">
              Nothing installed from the feed yet. Browse to add Git and others.
            </div>
          ) : null}
          <Row
            title="Update plugins by themselves"
            detail="New versions install in the background, checked against Anur's signature. On by default."
          >
            <Switch
              on={data?.autoUpdate ?? true}
              label="Update plugins by themselves"
              onChange={(on) => {
                void anur.call("market:set", { autoUpdate: on }).then(reload);
              }}
            />
          </Row>
        </>
      )}
      {note ? <p className="settings-row-detail">{note}</p> : null}
    </>
  );
}

function InstalledPlugin({
  plugin: p,
  folder,
  on,
  onChanged,
  onNote,
}: {
  plugin: MarketPlugin;
  folder: FolderState | null;
  on: boolean;
  onChanged: () => void;
  onNote: (note: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [said, setSaid] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  useEffect(() => {
    if (open && on)
      void anur.call("plugin:settings", { id: p.id }).then((r) => {
        setValues(r.values);
      });
  }, [open, on, p.id, folder?.path]);
  const set = (key: string, value: string | boolean) => {
    setValues((v) => ({ ...v, [key]: value }));
    void anur.call("plugin:set-setting", { id: p.id, key, value });
  };
  return (
    <div className="market-plugin">
      <Row
        title={p.name}
        detail={`${p.what} v${p.version}, updates itself.${folder ? "" : " Open a folder to switch it on."}`}
      >
        <Switch
          on={on}
          label={`${p.name} for this folder`}
          disabled={!folder}
          onChange={(next) => {
            onNote(null);
            void anur.call("market:set", { id: p.id, on: next }).then((r) => {
              if (r.error) onNote(r.error);
              onChanged();
            });
          }}
        />
      </Row>
      <div className="market-plugin-links">
        {on ? (
          <button
            type="button"
            className="think-more"
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
            }}
          >
            {open ? "Hide settings" : "Settings"}
          </button>
        ) : null}
        <button
          type="button"
          className="think-more danger"
          onClick={() => {
            if (!window.confirm(`Uninstall ${p.name}? Its settings for every folder go too.`))
              return;
            void anur.call("market:uninstall", { id: p.id }).then((r) => {
              if (r.error) onNote(r.error);
              onChanged();
            });
          }}
        >
          Uninstall
        </button>
      </div>
      {open && on ? (
        <div className="market-plugin-settings">
          {p.settings.map((x) =>
            x.type === "toggle" ? (
              <Row key={x.key} title={x.label} detail={x.detail ?? ""}>
                <Switch
                  on={values[x.key] === true}
                  label={x.label}
                  onChange={(v) => {
                    set(x.key, v);
                  }}
                />
              </Row>
            ) : x.type === "choice" ? (
              <Row key={x.key} title={x.label} detail={x.detail ?? ""}>
                <select
                  className="settings-select"
                  value={String(values[x.key] ?? "")}
                  onChange={(e) => {
                    set(x.key, e.target.value);
                  }}
                >
                  {(x.choices ?? []).map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Row>
            ) : (
              <Row key={x.key} title={x.label} detail={x.detail ?? ""}>
                <input
                  className="settings-input"
                  value={String(values[x.key] ?? "")}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [x.key]: e.target.value }));
                  }}
                  onBlur={(e) => {
                    set(x.key, e.target.value);
                  }}
                />
              </Row>
            ),
          )}
          <div className="market-plugin-actions">
            {p.actions.map((a) => (
              <button
                key={a.id}
                type="button"
                className="settings-button"
                disabled={acting !== null}
                onClick={() => {
                  setActing(a.id);
                  setSaid(null);
                  void anur
                    .call("plugin:action", { id: p.id, action: a.id })
                    .then((r) => {
                      setSaid(r.message);
                    })
                    .finally(() => {
                      setActing(null);
                    });
                }}
              >
                {acting === a.id ? "Working…" : a.label}
              </button>
            ))}
          </div>
          {said ? <p className="settings-row-detail">{said}</p> : null}
        </div>
      ) : null}
    </div>
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
    void anur.call("settings:set", c).then((now) => {
      setMain(now);
      // The side chat shows whether edits apply as they land.
      window.dispatchEvent(new CustomEvent("anur:settings-changed"));
    });
  };
  const [pageFont, setPageFont] = useState<PageFont>(() => loadPageFont(window.localStorage));
  const [mapStyle, setMapStyle] = useState<MapStyle>(() => loadMapStyle(window.localStorage));
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
            <Row
              title="Map style"
              detail="How the map draws its boxes and lines: clean, or hand-drawn as Excalidraw draws."
            >
              <div className="segmented" role="radiogroup" aria-label="Map style">
                {(["clean", "hand"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mapStyle === m}
                    className="segmented-option"
                    onClick={() => {
                      setMapStyle(m);
                      saveMapStyle(window.localStorage, m);
                    }}
                  >
                    {m === "clean" ? "Clean" : "Hand-drawn"}
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
            <h2>Plugins</h2>
            <p className="settings-lede">
              Each is switched on for one folder; Anur's core works without them. Plugins from
              others come later, once each can run in its own sandbox.
            </p>
            <Market folder={folder} />
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
