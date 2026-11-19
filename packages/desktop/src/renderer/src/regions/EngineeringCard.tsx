import { useEffect, useState } from "react";
import { anur } from "../bridge.ts";

/**
 * The Engineering offer: once, when a folder holding code repos opens with
 * Engineering off. Turn on switches it on for the folder and opens the
 * System tab; when task reports aren't in Claude Code yet, a second step
 * asks for that on its own, since it changes the person's Claude Code.
 * Not now is remembered for the folder, on this device.
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
    // Storage off: the card may ask again next time.
  }
}

type Step = { kind: "offer"; folder: string; repos: number } | { kind: "hooks"; folder: string };

export function EngineeringCard() {
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const check = () => {
      void anur.call("engineering:offer", {}).then((o) => {
        if (!current) return;
        if (!o.folder || o.on || o.repos === 0 || answered(o.folder)) {
          setStep(null);
          return;
        }
        setStep({ kind: "offer", folder: o.folder, repos: o.repos });
      });
    };
    check();
    const off = anur.on("folder:changed", check);
    return () => {
      current = false;
      off();
    };
  }, []);
  if (!step) return null;
  const done = () => {
    remember(step.folder);
    setStep(null);
  };
  const turnOn = () => {
    setBusy(true);
    setError(null);
    void anur.call("plugins:set", { id: "engineering", on: true }).then(async (r) => {
      setBusy(false);
      if (r.kind === "refused") {
        setError(r.reason);
        return;
      }
      remember(step.folder);
      window.dispatchEvent(new CustomEvent("anur:engineering-on"));
      const hooks = await anur.call("taskHooks:status", {});
      setStep(hooks.claude && !hooks.added ? { kind: "hooks", folder: step.folder } : null);
    });
  };
  const addHooks = () => {
    setBusy(true);
    setError(null);
    void anur.call("taskHooks:act", { action: "add" }).then((r) => {
      setBusy(false);
      if (r.kind === "failed") setError(r.reason);
      else setStep(null);
    });
  };
  return (
    <aside className="skill-card" role="dialog" aria-label="Engineering for this folder">
      {step.kind === "offer" ? (
        <>
          <strong>
            This folder holds {step.repos} code {step.repos === 1 ? "repo" : "repos"}
          </strong>
          <p>
            Turn on Engineering: the system across your repos, and a report after each Claude Code
            task of what it changed.
          </p>
          <p className="quiet">Only for this folder. Switch it off in Settings, Plugins.</p>
        </>
      ) : (
        <>
          <strong>Also add task reports to Claude Code?</strong>
          <p>
            Anur adds its plugin to your Claude Code once for this Mac. It acts only in folders
            opened in Anur, and does nothing elsewhere.
          </p>
          <p className="quiet">Remove it in Settings, Plugins.</p>
        </>
      )}
      {error ? <p className="skill-card-error">{error}</p> : null}
      <div className="skill-card-actions">
        <button
          type="button"
          className="think-button primary"
          disabled={busy}
          onClick={step.kind === "offer" ? turnOn : addHooks}
        >
          {busy ? "Working…" : step.kind === "offer" ? "Turn on" : "Add to Claude Code"}
        </button>
        <button type="button" className="think-more" disabled={busy} onClick={done}>
          Not now
        </button>
      </div>
    </aside>
  );
}
