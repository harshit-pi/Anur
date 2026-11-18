import { useEffect, useState } from "react";
import { anur } from "../bridge.ts";

/**
 * The first-launch card (6.1): add `/anur` to the person's Claude Code, or
 * not now. Nothing is installed until they choose Add; afterwards a tip
 * says what they can now type. Shown once Claude Code is found and a
 * thread has answered, so it never greets someone who hasn't seen Anur yet.
 */
const ANSWERED = "anur.threadAnswered";

/** Whether a thread has answered on this device: the card waits for that. */
function threadAnswered(): boolean {
  try {
    return window.localStorage.getItem(ANSWERED) === "1";
  } catch {
    return false;
  }
}

function noteThreadAnswered() {
  try {
    window.localStorage.setItem(ANSWERED, "1");
  } catch {
    // Storage off: the card waits for the next answer instead.
  }
}

export function SkillCard() {
  const [show, setShow] = useState<"offer" | "tip" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let off: (() => void) | null = null;
    let current = true;
    void anur.call("skill:status", {}).then((s) => {
      if (!current || !s.claude || s.added || s.dismissed) return;
      // Offered once a thread has answered: first see what a doc here can do.
      if (threadAnswered()) {
        setShow("offer");
        return;
      }
      off = anur.on("thread:event", (e) => {
        if (
          e.kind === "thread" &&
          !e.thread.busy &&
          e.thread.items.some((i) => i.kind === "message" && i.role === "agent")
        ) {
          noteThreadAnswered();
          setShow("offer");
          off?.();
          off = null;
        }
      });
    });
    return () => {
      current = false;
      off?.();
    };
  }, []);
  if (!show) return null;
  return (
    <aside className="skill-card" role="dialog" aria-label="Use Anur from Claude Code">
      {show === "offer" ? (
        <>
          <strong>Use Anur from Claude Code</strong>
          <p>
            Add <code>/anur</code> to Claude Code: in any chat, <code>/anur doc</code> turns the
            chat into a doc here, with the chat kept on its title.
          </p>
          <p className="quiet">
            Anur adds a skill and its tools to your Claude Code, and keeps them up to date. Remove
            them in Settings, Agent.
          </p>
          {error ? <p className="skill-card-error">{error}</p> : null}
          <div className="skill-card-actions">
            <button
              type="button"
              className="think-button primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void anur.call("skill:act", { action: "add" }).then((r) => {
                  setBusy(false);
                  if (r.kind === "done") setShow("tip");
                  else setError(r.reason);
                });
              }}
            >
              {busy ? "Adding…" : "Add to Claude Code"}
            </button>
            <button
              type="button"
              className="think-more"
              disabled={busy}
              onClick={() => {
                setShow(null);
                void anur.call("skill:act", { action: "dismiss" });
              }}
            >
              Not now
            </button>
          </div>
        </>
      ) : (
        <>
          <strong>Added to Claude Code</strong>
          <p>In a Claude Code chat, type:</p>
          <ul>
            <li>
              <code>/anur doc</code> to turn the chat into a doc here
            </li>
            <li>
              <code>/anur new</code> to start a doc of headings
            </li>
            <li>
              <code>/anur open</code> to open a file here
            </li>
          </ul>
          <p className="quiet">
            A Claude Code session that was already open needs a restart to see it.
          </p>
          <div className="skill-card-actions">
            <button
              type="button"
              className="think-button primary"
              onClick={() => {
                setShow(null);
              }}
            >
              Got it
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
