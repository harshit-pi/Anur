import { useCallback, useEffect, useState } from "react";
import { anur } from "../bridge.ts";
import { taskTitle, type TaskReport } from "../layout/task-report.ts";
import {
  boxesAt,
  partIdsUnder,
  trailTo,
  type SystemBox,
  type SystemSection,
} from "../layout/system-levels.ts";

type Proposal = { group: string; name: string; merge: string[] };
type Review = {
  pending: Proposal[];
  reviewed: string[];
  asking: boolean;
  askingSince: string | null;
  failed: string | null;
};

/**
 * While Claude names the groups: a bar that moves without a percentage, since
 * the answer comes whole, and the seconds so far, so a long ask reads as running.
 */
function Asking({ since }: { since: string | null }) {
  const start = since ? Date.parse(since) : Date.now();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, []);
  const secs = Math.max(0, Math.round((now - start) / 1000));
  return (
    <div className="system-asking" role="status">
      <span className="quiet">Claude is suggesting names for the groups… {secs} s</span>
      <div className="system-bar" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}

type Shown =
  | { kind: "reading" }
  | { kind: "off" }
  | { kind: "failed"; reason: string }
  | { kind: "ok"; sections: SystemSection[]; review: Review };

/**
 * The system tab (group 20): the folder's repos, read by the engineering
 * plugin in the index process. A click opens a box one level deeper; the
 * trail goes back. Claude proposes names for groups once (20.6); the person
 * accepts, renames or keeps the rule's name (20.6a); parts not yet seen say
 * so (20.6b).
 */
/** Recent task reports atop the system (group 21); a click opens one in its tab. */
function RecentTasks({ onOpen }: { onOpen: (id: string) => void }) {
  const [reports, setReports] = useState<TaskReport[]>([]);
  useEffect(() => {
    const read = () => {
      void anur.call("tasks:list", {}).then((r) => {
        setReports(r.reports);
      });
    };
    read();
    return anur.on("tasks:changed", read);
  }, []);
  if (!reports.length) return null;
  return (
    <section className="system-tasks">
      <h2>Recent tasks</h2>
      {reports.slice(0, 5).map((r) => (
        <button
          key={r.id}
          type="button"
          className="system-task"
          onClick={() => {
            onOpen(r.id);
          }}
        >
          <span>{taskTitle(r)}</span>
          <span className="quiet">
            {r.repos.map((x) => x.dir).join(", ")} · {String(r.lines.length)} files
          </span>
        </button>
      ))}
    </section>
  );
}

export function SystemView({
  onPlugins,
  onOpenTask,
}: {
  onPlugins: () => void;
  onOpenTask: (id: string) => void;
}) {
  const [shown, setShown] = useState<Shown>({ kind: "reading" });
  const [at, setAt] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const read = useCallback(() => {
    setShown((s) => (s.kind === "ok" ? s : { kind: "reading" }));
    void anur.call("system:sections", {}).then((r) => {
      setShown(r);
    });
  }, []);
  useEffect(() => {
    read();
    // A build file changed, or the review did: read again (20.8).
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
  const { review } = shown;
  const reviewed = new Set(review.reviewed);
  // A level that vanished on a rescan or a merge goes back to the top.
  const level = at && all.some((s) => s.id === at) ? at : null;
  const trail = trailTo(all, level);
  const boxes = boxesAt(all, level, reviewed);
  const nameOf = (id: string) => all.find((s) => s.id === id)?.path.at(-1) ?? id;
  const unseen = [...new Set(boxes.flatMap((b) => b.parts))].filter((p) => !reviewed.has(p));
  const decide = (
    b: SystemBox,
    action: "accept" | "rename" | "dismiss",
    name?: string,
    merge: string[] = [],
  ) => {
    // Accepting or renaming counts the group's parts as seen, a merge's too.
    const parts = [...b.parts, ...merge.flatMap((m) => partIdsUnder(all, m))];
    void anur.call("system:decide", {
      group: b.id,
      action,
      ...(name ? { name } : {}),
      parts: action === "dismiss" ? [] : parts,
    });
  };

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
        <span className="system-actions">
          {level && unseen.length ? (
            <button
              type="button"
              title="Count every part on this level as seen"
              onClick={() => {
                void anur.call("system:reviewed", { parts: unseen });
              }}
            >
              Mark {unseen.length} reviewed
            </button>
          ) : null}
          <button type="button" title="Read the repos again" onClick={read}>
            Rescan
          </button>
        </span>
      </nav>
      {level ? null : <RecentTasks onOpen={onOpenTask} />}
      {review.asking ? (
        <Asking since={review.askingSince} />
      ) : review.failed ? (
        <p className="system-note quiet" role="status">
          Claude couldn't suggest names: {review.failed}{" "}
          <button
            type="button"
            className="system-inline"
            onClick={() => {
              void anur.call("system:propose", {});
            }}
          >
            Try again
          </button>
        </p>
      ) : null}
      {boxes.length === 0 ? (
        <p className="quiet">No repos in this folder.</p>
      ) : (
        <div className="system-grid">
          {boxes.map((b) => {
            const proposal = review.pending.find((p) => p.group === b.id);
            const line =
              b.kind === "part" ? (
                <span className="system-line">
                  {b.line}
                  {b.unreviewed ? <span className="system-tag">unreviewed</span> : null}
                </span>
              ) : (
                <span className="system-line">
                  {b.line}
                  {b.unreviewed ? (
                    <span className="system-unseen"> · {b.unreviewed} unreviewed</span>
                  ) : null}
                </span>
              );
            const name =
              renaming === b.id ? (
                <input
                  className="system-rename"
                  aria-label={`New name for ${b.name}`}
                  defaultValue={proposal?.name ?? b.name}
                  autoFocus
                  maxLength={60}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRenaming(null);
                    if (e.key !== "Enter") return;
                    const next = e.currentTarget.value.trim();
                    setRenaming(null);
                    if (next && next !== b.name) decide(b, "rename", next);
                  }}
                  onBlur={() => {
                    setRenaming(null);
                  }}
                />
              ) : (
                <span className="system-name">{b.name}</span>
              );
            return (
              <div
                key={b.id}
                className={`system-box ${b.empty ? "empty" : b.kind === "part" ? "part" : "opens"}`}
              >
                {b.opens && renaming !== b.id ? (
                  <button
                    type="button"
                    className="system-open"
                    onClick={() => {
                      setAt(b.id);
                    }}
                  >
                    {name}
                    {line}
                  </button>
                ) : (
                  <>
                    {name}
                    {line}
                  </>
                )}
                {proposal ? (
                  <div className="system-proposal">
                    <span>
                      Claude: “{proposal.name}”
                      {proposal.merge.length
                        ? `, with ${proposal.merge.map(nameOf).join(", ")}`
                        : ""}
                    </span>
                    <span className="system-proposal-actions">
                      <button
                        type="button"
                        onClick={() => {
                          decide(b, "accept", undefined, proposal.merge);
                        }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenaming(b.id);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        title={`Keep the name ${b.name}`}
                        onClick={() => {
                          decide(b, "dismiss");
                        }}
                      >
                        Keep
                      </button>
                    </span>
                  </div>
                ) : b.kind === "group" && renaming !== b.id ? (
                  <button
                    type="button"
                    className="system-rename-link"
                    onClick={() => {
                      setRenaming(b.id);
                    }}
                  >
                    Rename
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
