import { useEffect, useMemo, useRef, useState } from "react";
import {
  innerLines,
  layoutMap,
  routeLines,
  type MapLine,
  type MapNode,
} from "../layout/system-map.ts";
import { endName, type SystemEdge, type SystemSection } from "../layout/system-levels.ts";
import { SystemIcon } from "../icons/system/index.tsx";

type View = { x: number; y: number; z: number };
type Offset = { dx: number; dy: number };

/** Where the person dragged boxes, by ID, kept on this device. */
const MOVED = "anur.systemMap.moved";
function loadMoved(): Record<string, Offset> {
  try {
    return JSON.parse(window.localStorage.getItem(MOVED) ?? "{}") as Record<string, Offset>;
  } catch {
    return {};
  }
}
function saveMoved(m: Record<string, Offset>) {
  try {
    window.localStorage.setItem(MOVED, JSON.stringify(m));
  } catch {
    // Storage off: moves last until the app closes.
  }
}

/** The view that shows every box, never zoomed past 100%. */
function fitView(nodes: MapNode[], w: number, h: number): View {
  if (!nodes.length) return { x: 24, y: 24, z: 1 };
  const x0 = Math.min(...nodes.map((n) => n.x));
  const y0 = Math.min(...nodes.map((n) => n.y));
  const x1 = Math.max(...nodes.map((n) => n.x + n.w));
  const y1 = Math.max(...nodes.map((n) => n.y + n.h));
  const z = Math.max(0.2, Math.min(1, (w - 48) / (x1 - x0), (h - 80) / (y1 - y0)));
  return { x: (w - (x1 - x0) * z) / 2 - x0 * z, y: 24 - y0 * z, z };
}

/**
 * The system as a map (24.4) on the same whiteboard as a page's map: drag
 * the background or scroll to pan, pinch or ⌘-scroll to zoom, drag a box
 * anywhere. A click opens a repo or group in place; a click on a line shows
 * its calls. Fit, Tidy and Collapse all sit in the corner.
 */
export function SystemMap({
  sections,
  edges,
  scope,
  open,
  onToggle,
  onCollapseAll,
  onHide,
  onShow,
}: {
  sections: SystemSection[];
  edges: SystemEdge[];
  scope: string | null;
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onCollapseAll: () => void;
  /** Hide one call or link: a person's word that the code misled. */
  onHide: (edge: string) => void;
  /** Bring a hidden call or link back. */
  onShow: (edge: string) => void;
}) {
  const laid = useMemo(
    () => layoutMap(sections, edges, scope, open),
    [sections, edges, scope, open],
  );
  const [moved, setMoved] = useState<Record<string, Offset>>(loadMoved);
  // A box moves with its frame: its offset adds its own and its frames'.
  const nodes = useMemo(() => {
    const parent = new Map(laid.nodes.map((n) => [n.id, n.parent]));
    const shift = (id: string): Offset => {
      let dx = 0;
      let dy = 0;
      for (let at: string | null = id; at; at = parent.get(at) ?? null) {
        dx += moved[at]?.dx ?? 0;
        dy += moved[at]?.dy ?? 0;
      }
      return { dx, dy };
    };
    return laid.nodes.map((n) => {
      const s = shift(n.id);
      return { ...n, x: n.x + s.dx, y: n.y + s.dy };
    });
  }, [laid, moved]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inner = useMemo(() => innerLines(nodes, laid.lines), [nodes, laid.lines]);
  /** The box the pointer is on: its lines show, inside its repo too, and the rest fade. */
  const [hover, setHover] = useState<string | null>(null);
  // Focus lingers a moment after the pointer leaves, and stays while it's on
  // one of the box's lines, so a line can be reached and clicked.
  const letGo = useRef(0);
  const holdFocus = (id: string | null) => {
    window.clearTimeout(letGo.current);
    if (id) setHover(id);
  };
  const releaseFocus = () => {
    window.clearTimeout(letGo.current);
    letGo.current = window.setTimeout(() => {
      setHover(null);
    }, 1500);
  };
  useEffect(
    () => () => {
      window.clearTimeout(letGo.current);
    },
    [],
  );
  // Only the lines on show take a place on a box's side.
  const routes = useMemo(
    () =>
      routeLines(
        nodes,
        laid.lines.filter((l) => !inner.has(l.key) || hover === l.from || hover === l.to),
      ),
    [nodes, laid.lines, inner, hover],
  );
  const hidden = edges.filter((e) => e.state === "hidden");
  const [listing, setListing] = useState(false);
  const anyMoved = laid.nodes.some((n) => moved[n.id]);

  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  /** The person panned or zoomed: the map stays where they put it. Until then it fits itself. */
  const userMoved = useRef(false);
  const fit = () => {
    const el = host.current;
    if (el) setView(fitView(nodes, el.clientWidth, el.clientHeight));
  };
  // Frame it on first draw, and again when boxes come or go, unless the person moved it.
  const count = nodes.length;
  useEffect(() => {
    if (!view || !userMoved.current) fit();
  }, [count]);

  // Scroll pans; pinch or ⌘-scroll zooms around the pointer.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) && (e.target as HTMLElement).closest(".line-card")) return;
      e.preventDefault();
      userMoved.current = true;
      setView((v) => {
        if (!v) return v;
        if (e.ctrlKey || e.metaKey) {
          const r = el.getBoundingClientRect();
          const px = e.clientX - r.left;
          const py = e.clientY - r.top;
          const z = Math.min(2.5, Math.max(0.2, v.z * Math.exp(-e.deltaY * 0.01)));
          return { x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z, z };
        }
        return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  // The card a click on a line opens: its calls, each with where it was found.
  const [card, setCard] = useState<{ key: string; x: number; y: number } | null>(null);
  const cardLine = card ? laid.lines.find((l) => l.key === card.key) : undefined;

  /** Follows a drag from a pointer down; a press that doesn't move is a click. */
  const follow = (
    e: React.PointerEvent,
    onMove: (dx: number, dy: number) => void,
    onDone: (dragged: boolean) => void,
  ) => {
    const el = e.currentTarget as HTMLElement;
    const start = { x: e.clientX, y: e.clientY };
    let dragging = false;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone.
    }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) < 4) return;
      dragging = true;
      onMove(dx, dy);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      onDone(dragging);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget || !view) return;
    const v0 = view;
    follow(
      e,
      (dx, dy) => {
        userMoved.current = true;
        setView({ ...v0, x: v0.x + dx, y: v0.y + dy });
      },
      (dragged) => {
        if (!dragged) setCard(null);
      },
    );
  };

  // A box: a click opens it, a drag moves it (and what's inside) anywhere.
  const onNodeDown = (e: React.PointerEvent, n: MapNode) => {
    if (e.button !== 0 || !view) return;
    e.stopPropagation();
    const z = view.z;
    const before = moved;
    const was = before[n.id] ?? { dx: 0, dy: 0 };
    let last = before;
    follow(
      e,
      (dx, dy) => {
        last = { ...before, [n.id]: { dx: was.dx + dx / z, dy: was.dy + dy / z } };
        setMoved(last);
      },
      (dragged) => {
        if (dragged) saveMoved(last);
        else if (n.opens) onToggle(n.id);
      },
    );
  };

  // The lines on show: a repo's own wiring only beside the box pointed at.
  const shownLines = laid.lines.flatMap((l) => {
    const b = byId.get(l.to);
    const p = routes.get(l.key);
    const touches = hover === l.from || hover === l.to;
    if (!b || !p || (inner.has(l.key) && !touches)) return [];
    return [{ l, p, b, touches }];
  });
  const v = view ?? { x: 0, y: 0, z: 1 };
  const frames = nodes.filter((n) => n.open);
  const boxes = nodes.filter((n) => !n.open);
  const node = (n: MapNode) => (
    <div
      key={n.id}
      className={`map-node ${n.kind}${n.open ? " open" : ""}${n.grey ? " grey" : ""}${n.opens ? " opens" : ""}`}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
      role={n.opens ? "button" : undefined}
      tabIndex={n.opens ? 0 : undefined}
      title={n.opens ? (n.open ? `Close ${n.name}` : `Open ${n.name}`) : undefined}
      aria-expanded={n.opens ? n.open : undefined}
      onPointerDown={(e) => {
        onNodeDown(e, n);
      }}
      onPointerEnter={() => {
        if (!n.open) holdFocus(n.id);
      }}
      onPointerLeave={() => {
        if (!n.open) releaseFocus();
      }}
      onKeyDown={(e) => {
        if (n.opens && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onToggle(n.id);
        }
      }}
    >
      <span className="map-node-head">
        <SystemIcon kind={n.icon} />
        <span className="map-node-name">{n.name}</span>
      </span>
      {n.open || !n.line ? null : <span className="map-node-line">{n.line}</span>}
    </div>
  );
  return (
    <div
      ref={host}
      className="map system-map"
      role="figure"
      aria-label="The system's repos and the calls between them"
      onPointerDown={onBackgroundDown}
    >
      <div
        className="map-world"
        style={{
          transform: `translate(${String(v.x)}px, ${String(v.y)}px) scale(${String(v.z)})`,
          // Unseen until framed, so boxes never jump from the corner as the map opens.
          visibility: view ? "visible" : "hidden",
        }}
      >
        {frames.map(node)}
        <svg className="system-map-lines" width={1} height={1}>
          {shownLines.map(({ l, p, b, touches }) => (
            <g
              key={l.key}
              className={`map-line${l.grey ? " grey" : ""}${hover && !touches ? " faded" : ""}${l.guessed ? " guessed" : ""}${b.kind === "stub" ? " stub" : ""}`}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onPointerEnter={() => {
                if (touches) holdFocus(null);
              }}
              onPointerLeave={() => {
                if (touches) releaseFocus();
              }}
              onClick={() => {
                setCard({ key: l.key, x: p.mx, y: p.my });
              }}
            >
              <path d={p.d} className="map-line-hit" />
              <path d={p.d} className="map-line-path" />
              <title>{l.label}</title>
            </g>
          ))}
        </svg>
        {boxes.map(node)}
        {/* Labels sit above the boxes, so a box never cuts one. Counts print; a
            lone link's name shows on hover, so labels don't pile up. */}
        <svg className="system-map-lines labels" width={1} height={1} aria-hidden="true">
          {shownLines.map(({ l, p, touches }) =>
            l.count > 1 || laid.lines.length <= 12 ? (
              <text
                key={l.key}
                x={p.mx}
                y={p.my - 6}
                textAnchor="middle"
                className={`map-line-label${l.grey ? " grey" : ""}${hover && !touches ? " faded" : ""}${l.guessed ? " guessed" : ""}`}
              >
                {l.label}
              </text>
            ) : null,
          )}
        </svg>
        {card && cardLine ? (
          <LineCard
            line={cardLine}
            from={byId.get(cardLine.from)?.name ?? ""}
            to={byId.get(cardLine.to)?.name ?? ""}
            x={card.x + 12}
            y={card.y + 8}
            onHide={onHide}
            onClose={() => {
              setCard(null);
            }}
          />
        ) : null}
      </div>
      <div
        className="map-tools"
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
      >
        <button
          type="button"
          className="map-tool"
          title="Fit the map in view"
          onClick={() => {
            userMoved.current = false;
            fit();
          }}
        >
          Fit
        </button>
        <button
          type="button"
          className="map-tool"
          title="Put moved boxes back in the layout"
          disabled={!anyMoved}
          onClick={() => {
            const shownIds = new Set(laid.nodes.map((n) => n.id));
            const next = Object.fromEntries(
              Object.entries(moved).filter(([id]) => !shownIds.has(id)),
            );
            setMoved(next);
            saveMoved(next);
          }}
        >
          Tidy
        </button>
        <button
          type="button"
          className="map-tool"
          title="Close every open repo and group (Esc closes one level)"
          disabled={open.size === 0}
          onClick={() => {
            userMoved.current = false;
            setCard(null);
            onCollapseAll();
          }}
        >
          Collapse all
        </button>
        {hidden.length ? (
          <button
            type="button"
            className={`map-tool${listing ? " on" : ""}`}
            title="Lines you hid; show any of them again"
            aria-expanded={listing}
            onClick={() => {
              setListing((x) => !x);
            }}
          >
            {hidden.length} hidden
          </button>
        ) : null}
        <span className="map-zoom quiet">{Math.round(v.z * 100)}%</span>
      </div>
      {listing && hidden.length ? (
        <div
          className="line-card hidden-lines"
          role="dialog"
          aria-label="Hidden lines"
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
        >
          <div className="line-card-head">
            <span>Hidden lines</span>
            <button
              type="button"
              className="line-card-close"
              aria-label="Close"
              onClick={() => {
                setListing(false);
              }}
            >
              ×
            </button>
          </div>
          <ul>
            {hidden.map((e) => (
              <li key={e.id}>
                <span>
                  {endName(sections, e.from).name} <span className="edge-arrow">─▶</span>{" "}
                  {endName(sections, e.to).name}
                </span>
                <code className="edge-label">{e.label}</code>
                {e.how === "guessed" ? <span className="edge-guessed"> guessed</span> : null}
                <span className="edge-where">{e.evidence}</span>
                <button
                  type="button"
                  className="line-card-hide"
                  onClick={() => {
                    onShow(e.id);
                  }}
                >
                  Show
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** A line's calls or links, beside it on the map: each with where the code shows it. */
function LineCard({
  line,
  from,
  to,
  x,
  y,
  onHide,
  onClose,
}: {
  line: MapLine;
  from: string;
  to: string;
  x: number;
  y: number;
  onHide: (edge: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="line-card"
      role="dialog"
      aria-label={`${from} to ${to}`}
      style={{ left: x, top: y }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <div className="line-card-head">
        <span>
          {from} <span className="edge-arrow">─▶</span> {to}
        </span>
        <button type="button" className="line-card-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <ul>
        {line.edges.map((e) => (
          <li key={e.id}>
            <code className="edge-label">{e.label}</code>
            {e.how === "guessed" ? <span className="edge-guessed"> guessed</span> : null}
            <span className="edge-where">
              {e.evidence}
              {e.declared ? <span className="quiet"> → {e.declared}</span> : null}
            </span>
            <button
              type="button"
              className="line-card-hide"
              onClick={() => {
                onHide(e.id);
              }}
            >
              Hide
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
