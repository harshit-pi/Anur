import { useEffect, useState } from "react";
import { anur } from "../bridge.ts";

/**
 * Engineering, on by itself: a folder that opens holding code repos, which
 * the person hasn't answered for, gets Engineering switched on and a notice
 * saying so, with Undo (ask only when unsure: code repos are a sure sign).
 * The answer is remembered per folder on this device, so the notice shows
 * once. Adding task reports to Claude Code stays the person's own click,
 * since it changes their Claude Code for the whole Mac.
 */
const ANSWERED = (folder: string) => `anur.engineeringOffer:${folder}`;

function answered(folder: string): boolean {
  try {
    return window.localStorage.getItem(ANSWERED(folder)) === "1";
  } catch {
    return false;
  }
}

function remember(folder: string) {
  try {
    window.localStorage.setItem(ANSWERED(folder), "1");
  } catch {
    // Storage off: the notice may show again next time.
  }
}

type Shown = { folder: string; repos: number; hooks: boolean };

export function EngineeringCard() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Read after each await: the folder may have changed meanwhile.
    const alive = { now: true };
    const isAlive = () => alive.now;
    const check = () => {
      void anur.call("engineering:offer", {}).then(async (o) => {
        if (!isAlive()) return;
        if (!o.folder || o.on || o.repos === 0 || answered(o.folder)) {
          setShown(null);
          return;
        }
        const folder = o.folder;
        remember(folder);
        const r = await anur.call("plugins:set", { id: "engineering", on: true });
        if (!isAlive() || r.kind === "refused") return;
        window.dispatchEvent(new CustomEvent("anur:engineering-on"));
        const hooks = await anur.call("taskHooks:status", {});
        if (isAlive()) setShown({ folder, repos: o.repos, hooks: hooks.claude && !hooks.added });
      });
    };
    check();
    const off = anur.on("folder:changed", check);
    return () => {
      alive.now = false;
      off();
    };
  }, []);
  if (!shown) return null;
  const close = () => {
    setShown(null);
  };
  const undo = () => {
    setBusy(true);
    void anur.call("plugins:set", { id: "engineering", on: false }).then(() => {
      setBusy(false);
      window.dispatchEvent(new CustomEvent("anur:engineering-off"));
      setShown(null);
    });
  };
  const addHooks = () => {
    setBusy(true);
    setError(null);
    void anur.call("taskHooks:act", { action: "add" }).then((r) => {
      setBusy(false);
      if (r.kind === "failed") setError(r.reason);
      else setShown((s) => (s ? { ...s, hooks: false } : s));
    });
  };
  return (
    <aside className="skill-card" role="status" aria-label="Opened as a code system">
      <strong>
        Opened as a code system: {shown.repos} {shown.repos === 1 ? "repo" : "repos"} found
      </strong>
      <p>Repos opens a map of them, with the links between them found in code.</p>
      {shown.hooks ? (
        <p className="quiet">
          For a report after each Claude Code task, add Anur's plugin to Claude Code, once for this
          Mac.
        </p>
      ) : (
        <p className="quiet">Switch it off any time in Settings, Plugins.</p>
      )}
      {error ? <p className="skill-card-error">{error}</p> : null}
      <div className="skill-card-actions">
        {shown.hooks ? (
          <button type="button" className="think-button primary" disabled={busy} onClick={addHooks}>
            {busy ? "Working…" : "Add to Claude Code"}
          </button>
        ) : (
          <button type="button" className="think-button primary" disabled={busy} onClick={close}>
            OK
          </button>
        )}
        <button type="button" className="think-more" disabled={busy} onClick={undo}>
          Undo
        </button>
        {shown.hooks ? (
          <button type="button" className="think-more" disabled={busy} onClick={close}>
            Not now
          </button>
        ) : null}
      </div>
    </aside>
  );
}
