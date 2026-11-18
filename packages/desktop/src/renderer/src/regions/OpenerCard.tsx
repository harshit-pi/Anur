import { useEffect, useState } from "react";
import { anur } from "../bridge.ts";

/**
 * The offer to open Markdown files with Anur, as a browser offers to be the
 * default: once, after the Claude Code card has had its turn. Nothing changes
 * until they choose; Not now is remembered, and Settings keeps the choice.
 */
export function OpenerCard() {
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void Promise.all([anur.call("opener:status", {}), anur.call("skill:status", {})]).then(
      ([o, skill]) => {
        const skillCardShowing = skill.claude && !skill.added && !skill.dismissed;
        if (o.can && !o.isAnur && !o.dismissed && !skillCardShowing) setCurrent(o.current);
      },
    );
  }, []);
  if (current === undefined) return null;
  return (
    <aside className="skill-card" role="dialog" aria-label="Open Markdown files with Anur">
      <strong>Open Markdown files with Anur?</strong>
      <p>
        {current
          ? `${current} opens .md files from Finder now. Anur can open them instead, in the folder they belong to.`
          : "Anur can open .md files from Finder, in the folder they belong to."}
      </p>
      <p className="quiet">You can change this any time in Settings, General.</p>
      {failed ? (
        <p className="skill-card-error">macOS didn't allow the change. Try again from Settings.</p>
      ) : null}
      <div className="skill-card-actions">
        <button
          type="button"
          className="think-button primary"
          onClick={() => {
            void anur.call("opener:act", { action: "make" }).then((r) => {
              if (r.ok) setCurrent(undefined);
              else setFailed(true);
            });
          }}
        >
          Use Anur
        </button>
        <button
          type="button"
          className="think-more"
          onClick={() => {
            setCurrent(undefined);
            void anur.call("opener:act", { action: "dismiss" });
          }}
        >
          Not now
        </button>
      </div>
    </aside>
  );
}
