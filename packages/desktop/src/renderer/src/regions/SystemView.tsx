import { useCallback, useEffect, useState } from "react";
import { anur } from "../bridge.ts";
import { taskTitle, type TaskReport } from "../layout/task-report.ts";
import {
  boxesAt,
  trailTo,
  edgeGroups,
  endName,
  type SystemBox,
  type SystemEdge,
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
  | {
      kind: "ok";
      folder: string;
      sections: SystemSection[];
      review: Review;
      edges: SystemEdge[];
      misses: { detector: string; misses: string[] }[];
      repos: { dir: string; included: boolean }[];
    };

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

/** The last read, kept while the tab is closed, so coming back draws it at once. */
let lastRead: Extract<Shown, { kind: "ok" }> | null = null;

export function SystemView({
  folder,
  onPlugins,
  onOpenTask,
}: {
  folder: string | null;
  onPlugins: () => void;
  onOpenTask: (id: string) => void;
}) {
  const [shown, setShown] = useState<Shown>(() =>
    lastRead && lastRead.folder === folder ? lastRead : { kind: "reading" },
  );
  const [at, setAt] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const read = useCallback(() => {
    setShown((s) => (s.kind === "ok" ? s : { kind: "reading" }));
    void anur.call("system:sections", {}).then((r) => {
      if (r.kind === "ok") lastRead = r;
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
  // A level that vanished on a rescan or a merge goes back to the top.
  const level = at && all.some((s) => s.id === at) ? at : null;
  const trail = trailTo(all, level);
  const boxes = boxesAt(all, level);
  // Group names apply on their own, Claude's or the rule's; a rename is the person's last word.
  const rename = (b: SystemBox, name: string) => {
    void anur.call("system:decide", { group: b.id, action: "rename", name, parts: [] });
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
          {level ? null : (
            <button
              type="button"
              aria-expanded={choosing}
              title="Choose which repos are part of this folder's system"
              onClick={() => {
                setChoosing((c) => !c);
              }}
            >
              Choose repos
            </button>
          )}
          <button type="button" title="Read the repos again" onClick={read}>
            Rescan
          </button>
        </span>
      </nav>
      {choosing && !level ? <RepoChooser repos={shown.repos} /> : null}
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
            const line = <span className="system-line">{b.line}</span>;
            const name =
              renaming === b.id ? (
                <input
                  className="system-rename"
                  aria-label={`New name for ${b.name}`}
                  defaultValue={b.name}
                  autoFocus
                  maxLength={60}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setRenaming(null);
                    if (e.key !== "Enter") return;
                    const next = e.currentTarget.value.trim();
                    setRenaming(null);
                    if (next && next !== b.name) rename(b, next);
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
                {b.kind === "group" && renaming !== b.id ? (
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
      <EdgeList
        sections={all}
        edges={shown.edges}
        misses={shown.misses.flatMap((m) => m.misses)}
        within={level}
      />
    </div>
  );
}

/**
 * The lines between repos (group 22): edges found in code, grouped by the
 * repos they join, each with the call's file and line and where the route
 * is declared. A person confirms or hides each; hidden ones fold away.
 */
function EdgeList({
  sections,
  edges,
  misses,
  within,
}: {
  sections: SystemSection[];
  edges: SystemEdge[];
  misses: string[];
  within: string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const live = edges.filter((e) => e.state !== "hidden");
  const hidden = edges.filter((e) => e.state === "hidden");
  const groups = edgeGroups(sections, showHidden ? edges : live, within);
  if (!edges.length) return null;
  const act = (edge: string, action: "hide" | "show" | "confirm") => {
    void anur.call("system:edge", { edge, action });
  };
  return (
    <section className="system-edges">
      <h2>Lines between repos</h2>
      {groups.length === 0 ? <p className="quiet">None touch this level.</p> : null}
      {groups.map((g) => (
        <div key={g.key} className="edge-group">
          <button
            type="button"
            className="edge-head"
            aria-expanded={open === g.key}
            onClick={() => {
              setOpen((o) => (o === g.key ? null : g.key));
            }}
          >
            <span>
              {g.from} <span className="edge-arrow">─▶</span> {g.to}
              {g.stub ? <span className="edge-stub"> {g.stub}</span> : null}
            </span>
            <span className="quiet">
              {g.edges.length} {g.edges.length === 1 ? "call" : "calls"}
              {g.edges.some((e) => e.how === "guessed") ? ", some guessed" : ""}{" "}
              {open === g.key ? "▴" : "▾"}
            </span>
          </button>
          {open === g.key ? (
            <ul className="edge-rows">
              {g.edges.map((e) => (
                <li key={e.id} className={`edge-row ${e.state}`}>
                  <code className="edge-label">{e.label}</code>
                  <span className="edge-where">
                    {e.evidence}
                    {e.declared ? <span className="quiet"> → {e.declared}</span> : null}
                  </span>
                  <span className="edge-acts">
                    {e.how === "guessed" && e.state === "shown" ? (
                      // Several repos declare this route: the one thing worth asking.
                      <span className="edge-ask">
                        Is it {endName(sections, e.to).name}?{" "}
                        <button
                          type="button"
                          onClick={() => {
                            act(e.id, "confirm");
                            for (const o of edges)
                              if (
                                o.id !== e.id &&
                                o.from === e.from &&
                                o.evidence === e.evidence &&
                                o.how === "guessed"
                              )
                                act(o.id, "hide");
                          }}
                        >
                          Yes
                        </button>{" "}
                        <button
                          type="button"
                          onClick={() => {
                            act(e.id, "hide");
                          }}
                        >
                          No
                        </button>
                      </span>
                    ) : e.state === "hidden" ? (
                      <button
                        type="button"
                        onClick={() => {
                          act(e.id, "show");
                        }}
                      >
                        Show
                      </button>
                    ) : menu === e.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMenu(null);
                          act(e.id, "hide");
                        }}
                      >
                        Hide this line
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="edge-more"
                        aria-label="More for this line"
                        onClick={() => {
                          setMenu(e.id);
                        }}
                      >
                        ⋯
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      <p className="system-misses quiet">
        {hidden.length ? (
          <button
            type="button"
            className="system-inline"
            onClick={() => {
              setShowHidden((h) => !h);
            }}
          >
            {showHidden ? "Leave out hidden lines" : `${String(hidden.length)} hidden`}
          </button>
        ) : null}
        {hidden.length ? " · " : null}
        Found from HTTP calls in code. Misses {misses.join("; ")}.
      </p>
    </section>
  );
}

/**
 * Which repos are part of this folder's system: all by default; one left out
 * isn't scanned, watched, marked for tasks, or joined by edges.
 */
function RepoChooser({ repos }: { repos: { dir: string; included: boolean }[] }) {
  const inCount = repos.filter((r) => r.included).length;
  return (
    <section className="repo-chooser" aria-label="Repos in this folder's system">
      <p className="quiet">
        {inCount} of {repos.length} repos are in this folder's system. Untick one to leave it out.
      </p>
      <ul>
        {repos.map((r) => (
          <li key={r.dir}>
            <label>
              <input
                type="checkbox"
                checked={r.included}
                onChange={(e) => {
                  void anur.call("system:repo", { repo: r.dir, include: e.currentTarget.checked });
                }}
              />{" "}
              {r.dir}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
