/**
 * Threads whose section is gone from the doc, kept to read or move.
 */
import { useEffect, useRef, useState } from "react";
import type { ThreadView } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import { ThreadList } from "./ThreadList.tsx";

export type Orphan = {
  id: string;
  path: string[];
  threads: { id: string; title: string }[];
  history: boolean;
  suggestion: { index: number; path: string[] } | null;
};

/**
 * Orphaned (11.1, 11.2): sections whose heading is gone, with what was
 * behind them. Reattach moves their threads and history to a live section;
 * Delete removes them at once.
 */
export function Orphans({
  docPath,
  docText,
  threads,
  sections,
  writable,
  onOpen,
  onChanged,
}: {
  docPath: string;
  docText: () => string;
  threads: ThreadView[];
  sections: { path: string[] }[];
  writable: boolean;
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  /** The section picker, open on an orphan: its pick so far, -1 for none yet. */
  const [picking, setPicking] = useState<Record<string, number | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  // Read again when the doc's threads or headings change.
  const key = `${threads.map((t) => `${t.id}:${t.path?.join("/") ?? "-"}`).join(",")}|${sections
    .map((s) => s.path.join("/"))
    .join(",")}`;
  const text = useRef(docText);
  text.current = docText;
  useEffect(() => {
    let current = true;
    const t = window.setTimeout(() => {
      void anur.call("orphans:list", { path: docPath, text: text.current() }).then((r) => {
        if (current) setOrphans(r.orphans);
      });
    }, 300);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
  }, [docPath, key, n]);
  if (orphans.length === 0) return null;
  const done = () => {
    setN((x) => x + 1);
    onChanged();
  };
  const reattach = (o: Orphan, index: number) => {
    const target = sections[index];
    if (!target) return;
    setError(null);
    void anur
      .call("orphans:reattach", {
        path: docPath,
        text: text.current(),
        orphan: o.id,
        section: { index, path: target.path },
      })
      .then((r) => {
        if (r.kind === "refused") setError(r.reason);
        setPicking((p) => ({ ...p, [o.id]: undefined }));
        done();
      });
  };
  const remove = (o: Orphan) => {
    const what =
      o.threads.length > 0
        ? `its ${o.threads.length === 1 ? "thread" : `${String(o.threads.length)} threads`}, their proposed edits, its inputs and its history`
        : "its history";
    if (
      !window.confirm(
        `Delete what was behind “${o.path.at(-1) ?? "Untitled"}”: ${what}? This can't be undone.`,
      )
    )
      return;
    setError(null);
    void anur
      .call("orphans:delete", { path: docPath, text: text.current(), orphan: o.id })
      .then(done);
  };
  return (
    <details className="think-elsewhere think-orphans">
      <summary className="think-subhead">Orphaned ({String(orphans.length)})</summary>
      <p className="quiet think-orphans-why">Headings that are gone, with what was behind them.</p>
      {error ? <p className="think-error">{error}</p> : null}
      {orphans.map((o) => {
        const views = o.threads.flatMap((x) => threads.filter((t) => t.id === x.id));
        const choice = picking[o.id];
        const suggested = o.suggestion ? sections[o.suggestion.index] : undefined;
        return (
          <div key={o.id} className="think-elsewhere-group think-orphan">
            <div className="think-orphan-head">
              <span className="think-orphan-gone">{o.path.at(-1) ?? "Untitled"}</span>
              {suggested && choice === undefined ? (
                <span className="quiet"> → {suggested.path.at(-1) ?? "Untitled"}?</span>
              ) : null}
            </div>
            {views.length > 0 ? (
              <ThreadList threads={views} onOpen={onOpen} />
            ) : (
              <p className="quiet">{o.history ? "Its history only" : "Nothing behind it"}</p>
            )}
            {!writable ? null : choice === undefined ? (
              <div className="think-orphan-actions">
                {suggested && o.suggestion ? (
                  <button
                    type="button"
                    className="think-more"
                    onClick={() => {
                      if (o.suggestion) reattach(o, o.suggestion.index);
                    }}
                  >
                    Reattach to {suggested.path.at(-1) ?? "Untitled"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="think-more"
                  onClick={() => {
                    setPicking((p) => ({ ...p, [o.id]: -1 }));
                  }}
                >
                  {suggested ? "Other section…" : "Reattach to…"}
                </button>
                <button
                  type="button"
                  className="think-more danger"
                  onClick={() => {
                    remove(o);
                  }}
                >
                  Delete
                </button>
              </div>
            ) : (
              <div className="think-orphan-actions">
                <select
                  aria-label="Section to reattach to"
                  value={choice}
                  onChange={(e) => {
                    setPicking((p) => ({ ...p, [o.id]: Number(e.target.value) }));
                  }}
                >
                  <option value={-1}>Pick a section…</option>
                  {sections.map((s, i) => (
                    <option key={s.path.join("/")} value={i}>
                      {"  ".repeat(Math.max(0, s.path.length - 1))}
                      {s.path.at(-1) ?? "Untitled"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="think-more"
                  disabled={choice < 0}
                  onClick={() => {
                    reattach(o, choice);
                  }}
                >
                  Reattach
                </button>
                <button
                  type="button"
                  className="think-more quiet-action"
                  onClick={() => {
                    setPicking((p) => ({ ...p, [o.id]: undefined }));
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
    </details>
  );
}
