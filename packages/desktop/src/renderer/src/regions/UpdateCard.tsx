import { useEffect, useRef, useState } from "react";
import type { UpdateState } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";

/**
 * A new version, from the moment it's found: Update downloads it and restarts
 * into it in one click; once downloaded, Restart. Later hides it for that version.
 */
export function UpdateCard() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [later, setLater] = useState<string | null>(null);
  /** Update was clicked: restart as soon as the download is in. */
  const restartWhenReady = useRef(false);
  useEffect(() => {
    void anur.call("update:status", {}).then((s) => {
      setState(s.state);
    });
    return anur.on("app:update-state", (s) => {
      setState(s);
      if (s.kind === "ready" && restartWhenReady.current) void anur.call("update:restart", {});
    });
  }, []);
  if (
    !state ||
    (state.kind !== "available" && state.kind !== "downloading" && state.kind !== "ready") ||
    later === state.version
  )
    return null;
  const version = state.version;
  const update = () => {
    restartWhenReady.current = true;
    void anur.call("update:download", {});
  };
  return (
    <aside className="skill-card" role="dialog" aria-label="Update">
      <strong>
        {state.kind === "ready"
          ? `Anur ${version} is ready`
          : state.kind === "downloading"
            ? `Updating to Anur ${version}`
            : `Anur ${version} is available`}
      </strong>
      {state.notes?.length ? <WhatsNew notes={state.notes} /> : null}
      <p>
        {state.kind === "downloading"
          ? `Downloading… ${String(state.percent)}%. Anur restarts into it when it's done.`
          : "Your docs are saved, and Anur opens where you left off."}
      </p>
      {state.kind !== "downloading" ? (
        <div className="skill-card-actions">
          <button
            type="button"
            className="think-button primary"
            onClick={() => {
              if (state.kind === "ready") void anur.call("update:restart", {});
              else update();
            }}
          >
            {state.kind === "ready" ? "Restart to update" : "Update"}
          </button>
          <button
            type="button"
            className="think-more"
            onClick={() => {
              setLater(version);
            }}
          >
            Later
          </button>
        </div>
      ) : null}
    </aside>
  );
}

/** A version's notes, the first few; the rest are a count. */
export function WhatsNew({ notes }: { notes: readonly string[] }) {
  const shown = notes.slice(0, 4);
  return (
    <ul className="whats-new">
      {shown.map((n) => (
        <li key={n}>{n}</li>
      ))}
      {notes.length > shown.length ? (
        <li className="quiet">and {String(notes.length - shown.length)} more</li>
      ) : null}
    </ul>
  );
}

/** After an update: what's new in this version, once. */
export function WhatsNewCard() {
  const [seen, setSeen] = useState<{ version: string; notes: string[] } | null>(null);
  useEffect(() => {
    void anur.call("app:whats-new", { seen: false }).then(setSeen);
  }, []);
  if (!seen) return null;
  return (
    <aside className="skill-card" role="dialog" aria-label="What's new">
      <strong>{`Updated to Anur ${seen.version}`}</strong>
      <WhatsNew notes={seen.notes} />
      <div className="skill-card-actions">
        <button
          type="button"
          className="think-button primary"
          onClick={() => {
            setSeen(null);
            void anur.call("app:whats-new", { seen: true });
          }}
        >
          Got it
        </button>
      </div>
    </aside>
  );
}
