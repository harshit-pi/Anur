import { useEffect, useRef, useState } from "react";
import type { UpdateState } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";

/**
 * A new version, in the status bar as in VS Code: Update downloads it and
 * restarts into it in one click; once downloaded, Restart. Its notes on hover.
 */
export function UpdatePill() {
  const [state, setState] = useState<UpdateState | null>(null);
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
    (state.kind !== "available" && state.kind !== "downloading" && state.kind !== "ready")
  )
    return null;
  const notes = state.notes?.length
    ? `Anur ${state.version}\n${state.notes.map((n) => `• ${n}`).join("\n")}`
    : `Anur ${state.version}`;
  if (state.kind === "downloading")
    return (
      <span className="status-item update-pill busy" title={notes}>
        {`Updating ${String(state.percent)}%`}
      </span>
    );
  return (
    <button
      type="button"
      className="status-item update-pill"
      title={notes}
      onClick={() => {
        if (state.kind === "ready") {
          void anur.call("update:restart", {});
          return;
        }
        restartWhenReady.current = true;
        void anur.call("update:download", {});
      }}
    >
      {state.kind === "ready" ? "Restart to update" : "Update"}
    </button>
  );
}

/** The version in the status bar; after an update, what's new in it on hover. */
export function VersionItem({ version }: { version: string }) {
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => {
    void anur.call("app:whats-new", { seen: false }).then((r) => {
      setNotes(r?.notes ?? []);
    });
  }, [version]);
  return (
    <span
      className="status-item quiet"
      title={notes.length ? `What's new\n${notes.map((n) => `• ${n}`).join("\n")}` : undefined}
    >
      Anur {version}
    </span>
  );
}
