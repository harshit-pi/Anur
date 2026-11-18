import { useCallback, useEffect, useState } from "react";
import { anur } from "../bridge.ts";
import { boxesAt, trailTo, type SystemSection } from "../layout/system-levels.ts";

type Shown =
  | { kind: "reading" }
  | { kind: "off" }
  | { kind: "failed"; reason: string }
  | { kind: "ok"; sections: SystemSection[] };

/**
 * The system tab (group 20): the folder's repos, read by the engineering
 * plugin in the index process. A click opens a box one level deeper; the
 * trail goes back. No level shows more than a dozen or so boxes where a
 * rule could group them.
 */
export function SystemView({ onPlugins }: { onPlugins: () => void }) {
  const [shown, setShown] = useState<Shown>({ kind: "reading" });
  const [at, setAt] = useState<string | null>(null);
  const read = useCallback(() => {
    setShown((s) => (s.kind === "ok" ? s : { kind: "reading" }));
    void anur.call("system:sections", {}).then((r) => {
      setShown(r.kind === "ok" ? { kind: "ok", sections: r.sections } : r);
    });
  }, []);
  useEffect(() => {
    read();
    // A build file changed in one of the repos: read again (20.8).
    return anur.on("system:changed", read);
  }, [read]);

  if (shown.kind === "reading") return <div className="system-view quiet">Reading the repos…</div>;
  if (shown.kind === "off")
    return (
      <div className="system-view">
        <p className="quiet">The system map comes with the Engineering plugin.</p>
        <button type="button" className="think-button primary" onClick={onPlugins}>
          Turn on Engineering
        </button>
      </div>
    );
  if (shown.kind === "failed")
    return (
      <div className="system-view">
        <p className="quiet">Couldn't read the repos: {shown.reason}</p>
        <button type="button" className="think-button primary" onClick={read}>
          Try again
        </button>
      </div>
    );

  const all = shown.sections;
  // A level that vanished on a rescan goes back to the top.
  const level = at && all.some((s) => s.id === at) ? at : null;
  const trail = trailTo(all, level);
  const boxes = boxesAt(all, level);
  return (
    <div className="system-view">
      <nav className="system-trail" aria-label="Where you are">
        {level ? (
          <button
            type="button"
            onClick={() => {
              setAt(null);
            }}
          >
            All repos
          </button>
        ) : (
          <span aria-current="page">All repos</span>
        )}
        {trail.map((s, i) => (
          <span key={s.id} className="system-step">
            <span className="system-sep" aria-hidden="true">
              ›
            </span>
            {i < trail.length - 1 ? (
              <button
                type="button"
                onClick={() => {
                  setAt(s.id);
                }}
              >
                {s.path.at(-1)}
              </button>
            ) : (
              <span aria-current="page">{s.path.at(-1)}</span>
            )}
          </span>
        ))}
        <button type="button" className="system-rescan" onClick={read} title="Read the repos again">
          Rescan
        </button>
      </nav>
      {boxes.length === 0 ? (
        <p className="quiet">No repos in this folder.</p>
      ) : (
        <div className="system-grid">
          {boxes.map((b) =>
            b.opens ? (
              <button
                key={b.id}
                type="button"
                className="system-box opens"
                onClick={() => {
                  setAt(b.id);
                }}
              >
                <span className="system-name">{b.name}</span>
                <span className="system-line">{b.line}</span>
              </button>
            ) : (
              <div key={b.id} className={`system-box${b.empty ? " empty" : " part"}`}>
                <span className="system-name">{b.name}</span>
                <span className="system-line">{b.line}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
