import { useEffect, useRef, useState } from "react";
import type { PluginStatusView } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";

/**
 * What downloaded plugins show outside Settings (Plugins and Git mock): their
 * item in the status bar, with a panel a click opens, and the places they
 * can open a folder from, such as GitHub.
 */

/** Git's mark: a branch, drawn rather than a brand logo. */
export const GitIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <circle cx="4.5" cy="3.5" r="1.6" />
    <circle cx="4.5" cy="12.5" r="1.6" />
    <circle cx="11.5" cy="6" r="1.6" />
    <path d="M4.5 5.1v5.8M11.5 7.6c0 2.4-3 2.2-6.2 3.6" strokeLinecap="round" />
  </svg>
);

/** Every plugin's item for this window's folder, kept current. */
export function usePluginStatuses(folder: string | null): [string, PluginStatusView][] {
  const [items, setItems] = useState<Map<string, PluginStatusView>>(new Map());
  useEffect(() => {
    setItems(new Map());
    if (!folder) return;
    let current = true;
    void anur.call("plugin:statuses", {}).then((r) => {
      if (current) setItems(new Map(r.items.map((i) => [i.plugin, i.status])));
    });
    const off = anur.on("plugin:status", ({ plugin, status }) => {
      setItems((was) => {
        const next = new Map(was);
        if (status) next.set(plugin, status);
        else next.delete(plugin);
        return next;
      });
    });
    return () => {
      current = false;
      off();
    };
  }, [folder]);
  return [...items.entries()];
}

/** A plugin's status-bar item: its icon and a few words; a click opens its panel. */
export function PluginStatusItem({ plugin, status }: { plugin: string; status: PluginStatusView }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
    };
  }, [open]);
  return (
    <span className="plugin-status" ref={host}>
      <button
        type="button"
        className={`status-item plugin-status-item ${status.tone ?? "ok"}`}
        title={`${plugin === "git" ? "Git" : plugin}: ${status.text}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setNote(null);
        }}
      >
        {plugin === "git" ? <GitIcon /> : null}
        <span>{status.text}</span>
      </button>
      {open ? (
        <div className="plugin-panel" role="dialog" aria-label={`${plugin} status`}>
          <div className="plugin-panel-title">
            {plugin === "git" ? <GitIcon /> : null} {plugin === "git" ? "Git" : plugin}
          </div>
          <dl>
            {(status.lines ?? []).map((l) => (
              <div key={l.label}>
                <dt>{l.label}</dt>
                <dd>
                  {l.href ? (
                    <a
                      href={l.href}
                      onClick={(e) => {
                        e.preventDefault();
                        void anur.call("link:open-external", { url: l.href ?? "" });
                      }}
                    >
                      {l.value}
                    </a>
                  ) : (
                    l.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {note ? <p className="plugin-panel-note">{note}</p> : null}
          <div className="plugin-panel-actions">
            {(status.actions ?? []).map((a) => (
              <button
                key={a.id}
                type="button"
                className="think-button primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setNote(null);
                  void anur
                    .call("plugin:action", { id: plugin, action: a.id })
                    .then((r) => {
                      setNote(r.message);
                    })
                    .finally(() => {
                      setBusy(false);
                    });
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </span>
  );
}

type Source = {
  plugin: string;
  label: string;
  items: { id: string; label: string; detail: string }[];
};

/** "Open from GitHub" and the like: one button per plugin offering it, then a list to pick from. */
export function OpenFromButtons() {
  const [labels, setLabels] = useState<{ plugin: string; label: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void anur.call("market:list", {}).then((r) => {
      setLabels(
        r.installed.flatMap((p) => (p.openFrom ? [{ plugin: p.id, label: p.openFrom.label }] : [])),
      );
    });
  }, []);
  return (
    <>
      {labels.map((l) => (
        <button
          key={l.plugin}
          className="secondary-button"
          type="button"
          onClick={() => {
            setOpen(l.plugin);
          }}
        >
          {l.label}
        </button>
      ))}
      {open ? (
        <OpenFromList
          plugin={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </>
  );
}

function OpenFromList({ plugin, onClose }: { plugin: string; onClose: () => void }) {
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    void anur.call("open-from:list", {}).then((r) => {
      setError(r.error);
      setSource(r.sources.find((s) => s.plugin === plugin) ?? null);
    });
  }, [plugin]);
  const q = query.trim().toLowerCase();
  const items = (source?.items ?? []).filter((i) => !q || i.label.toLowerCase().includes(q));
  return (
    <div className="open-from" role="dialog" aria-label={source?.label ?? "Open from"}>
      <div className="open-from-head">
        <strong>{source?.label ?? "Open from GitHub"}</strong>
        <button type="button" className="think-icon" aria-label="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <input
        className="settings-input open-from-search"
        placeholder="Search your repos…"
        value={query}
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
      {error ? <p className="think-error">{error}</p> : null}
      {!source && !error ? <p className="quiet">Reading your repos…</p> : null}
      <ul className="open-from-items">
        {items.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              disabled={opening !== null}
              onClick={() => {
                setOpening(i.id);
                setError(null);
                void anur
                  .call("open-from:open", { plugin, id: i.id })
                  .then((r) => {
                    if (r.error) setError(r.error);
                    else onClose();
                  })
                  .finally(() => {
                    setOpening(null);
                  });
              }}
            >
              <span className="open-from-name">{i.label}</span>
              <span className="quiet">{opening === i.id ? "Cloning…" : i.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="quiet open-from-where">
        You pick where it goes; sync is on for it from the start.
      </p>
    </div>
  );
}
