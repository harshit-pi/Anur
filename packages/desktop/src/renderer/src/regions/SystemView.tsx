import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { anur } from "../bridge.ts";
import { SystemMap } from "./SystemMap.tsx";
import {
  boxesAt,
  trailTo,
  isInside,
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
      updating: boolean;
      sections: SystemSection[];
      review: Review;
      edges: SystemEdge[];
      misses: { detector: string; misses: string[] }[];
      repos: { dir: string; included: boolean; copyOf: string | null }[];
    };

/**
 * The system tab (group 20): the folder's repos, read by the engineering
 * plugin in the index process. A click opens a box one level deeper; the
 * trail goes back. Claude proposes names for groups once (20.6); the person
 * accepts, renames or keeps the rule's name (20.6a); parts not yet seen say
 * so (20.6b).
 */

/** Whether one section is inside another, for the Esc handler, set from the latest read. */
let isInsideId: (id: string, outer: string) => boolean = () => false;

const nameIn = (all: readonly SystemSection[], id: string) =>
  all.find((x) => x.id === id)?.path.at(-1) ?? id;

/** The last read, kept while the tab is closed, so coming back draws it at once. */
let lastRead: Extract<Shown, { kind: "ok" }> | null = null;

export function SystemView({
  folder,
  onPlugins,
}: {
  folder: string | null;
  onPlugins: () => void;
}) {
  const [shown, setShown] = useState<Shown>(() =>
    lastRead && lastRead.folder === folder ? lastRead : { kind: "reading" },
  );
  const [at, setAt] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  /** Frames opened on the map, and the line whose calls the list shows. */
  const [openFrames, setOpenFrames] = useState<ReadonlySet<string>>(new Set());
  // The right sidebar's slot for this tab, filled through a portal.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById("system-panel"));
  }, []);
  // Esc goes up a level: it closes the frame opened last, and what's open inside it.
  const framesNow = useRef(openFrames);
  framesNow.current = openFrames;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest("input, textarea, [contenteditable]")) return;
      const last = [...framesNow.current].at(-1);
      if (!last) return;
      e.preventDefault();
      setOpenFrames(
        new Set([...framesNow.current].filter((x) => x !== last && !isInsideId(x, last))),
      );
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
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
  // The open frames the person is in: the last one opened, and the open frames around it.
  const lastOpen = [...openFrames].at(-1);
  const frameTrail = lastOpen
    ? [...openFrames]
        .filter((x) => x === lastOpen || isInside(all, lastOpen, x))
        .sort((a, b) => Number(isInside(all, a, b)) - Number(isInside(all, b, a)))
    : [];
  isInsideId = (x, outer) => isInside(all, x, outer);
  // Several GitHub owners: pick one first, and its system is the map.
  const showOwners = !level && all.some((x) => x.id.startsWith("org:"));
  // Group names apply on their own, Claude's or the rule's; a rename is the person's last word.
  const rename = (b: SystemBox, name: string) => {
    void anur.call("system:decide", { group: b.id, action: "rename", name, parts: [] });
  };

  return (
    <div className={`system-view${showOwners ? "" : " whole"}`}>
      <nav className="system-trail" aria-label="Where you are">
        {level || frameTrail.length ? (
          <button
            type="button"
            onClick={() => {
              setAt(null);
              setOpenFrames(new Set());
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
            {i < trail.length - 1 || frameTrail.length ? (
              <button
                type="button"
                onClick={() => {
                  setAt(s.id);
                  setOpenFrames(new Set());
                }}
              >
                {s.path.at(-1)}
              </button>
            ) : (
              <span aria-current="page">{s.path.at(-1)}</span>
            )}
          </span>
        ))}
        {frameTrail.map((id, i) => (
          <span key={id} className="system-step">
            <span className="system-sep" aria-hidden="true">
              ›
            </span>
            {i < frameTrail.length - 1 ? (
              <button
                type="button"
                title="Go back to this level"
                onClick={() => {
                  // Closes what's open inside this frame; the frame stays open.
                  setOpenFrames((o) => new Set([...o].filter((x) => !isInside(all, x, id))));
                }}
              >
                {nameIn(all, id)}
              </button>
            ) : (
              <span aria-current="page">{nameIn(all, id)}</span>
            )}
          </span>
        ))}
        <span className="system-actions">
          {
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
          }
          {shown.updating ? (
            <span className="quiet" role="status">
              Updating…
            </span>
          ) : null}
          <button type="button" title="Read the repos again" onClick={read}>
            Rescan
          </button>
        </span>
      </nav>
      {choosing ? <RepoChooser repos={shown.repos} /> : null}
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
      {showOwners ? (
        boxes.length === 0 ? (
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
        )
      ) : (
        <SystemMap
          sections={all}
          edges={shown.edges}
          scope={level}
          open={openFrames}
          onToggle={(id) => {
            setOpenFrames((o) => {
              const next = new Set(o);
              if (next.has(id)) {
                // Closing a frame closes what's open inside it too.
                for (const x of [...next]) if (x === id || isInside(all, x, id)) next.delete(x);
              } else next.add(id);
              return next;
            });
          }}
          onCollapseAll={() => {
            setOpenFrames(new Set());
          }}
          onHide={(edge) => {
            void anur.call("system:edge", { edge, action: "hide" });
          }}
          onShow={(edge) => {
            void anur.call("system:edge", { edge, action: "show" });
          }}
        />
      )}
      {/* The right sidebar is for the agent on the map, which comes next. */}
      {slot
        ? createPortal(
            <p className="quiet system-side-note">
              The agent on the map will work here: ask about a repo or part, and it answers with
              what the code shows.
            </p>,
            slot,
          )
        : null}
    </div>
  );
}

/**
 * Which repos are part of this folder's system: all by default; one left out
 * isn't scanned, watched, marked for tasks, or joined by edges.
 */
function RepoChooser({
  repos,
}: {
  repos: { dir: string; included: boolean; copyOf: string | null }[];
}) {
  // Repos counted once: a second clone of one is marked, not counted again.
  const own = repos.filter((r) => !r.copyOf);
  const inCount = own.filter((r) => r.included).length;
  const copies = repos.length - own.length;
  return (
    <section className="repo-chooser" aria-label="Repos in this folder's system">
      <p className="quiet">
        {inCount} of {own.length} repos are in this folder's system
        {copies ? `, plus ${String(copies)} ${copies === 1 ? "copy" : "copies"} of them` : ""}.
        Untick one to leave it out.
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
              {r.copyOf ? <span className="quiet"> copy of {r.copyOf}</span> : null}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
