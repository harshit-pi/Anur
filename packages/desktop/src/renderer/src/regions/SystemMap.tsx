import { useEffect, useMemo, useRef, useState } from "react";
import { layoutMap, type MapLine, type MapNode } from "../layout/system-map.ts";
import type { SystemEdge, SystemSection } from "../layout/system-levels.ts";

const PAD = 24;

/** A curve from the right side of one box to the left side of the other. */
function path(a: MapNode, b: MapNode): { d: string; mx: number; my: number } {
  const forward = b.x >= a.x + a.w;
  const x1 = forward ? a.x + a.w : a.x;
  const x2 = forward ? b.x : b.x + b.w;
  const y1 = a.y + Math.min(a.h / 2, 32);
  const y2 = b.y + Math.min(b.h / 2, 32);
  const bend = Math.max(40, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
  return {
    d: `M${String(x1 + PAD)},${String(y1 + PAD)} C${String(x1 + bend + PAD)},${String(y1 + PAD)} ${String(x2 - bend + PAD)},${String(y2 + PAD)} ${String(x2 + PAD)},${String(y2 + PAD)}`,
    mx: (x1 + x2) / 2 + PAD,
    my: (y1 + y2) / 2 + PAD,
  };
}

/**
 * The system as a map (24.4): repos as frames, lines from code between them.
 * A click opens a repo or group in place; a click on a line shows its calls.
 */
export function SystemMap({
  sections,
  edges,
  scope,
  open,
  onToggle,
  onLine,
}: {
  sections: SystemSection[];
  edges: SystemEdge[];
  scope: string | null;
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onLine: (line: MapLine) => void;
}) {
  const map = useMemo(
    () => layoutMap(sections, edges, scope, open),
    [sections, edges, scope, open],
  );
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  // Fit the pane's width: scale down when the map is wider, never up.
  const wrap = useRef<HTMLDivElement>(null);
  const [paneW, setPaneW] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setPaneW(el.clientWidth);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  const fullW = map.width + PAD * 2;
  const fullH = map.height + PAD * 2;
  const scale = paneW > 0 ? Math.min(1, paneW / fullW) : 1;
  const frames = map.nodes.filter((n) => n.open);
  const boxes = map.nodes.filter((n) => !n.open);
  const node = (n: MapNode) => {
    const cls = `map-node ${n.kind}${n.open ? " open" : ""}${n.grey ? " grey" : ""}${n.opens ? " opens" : ""}`;
    const style = { left: n.x + PAD, top: n.y + PAD, width: n.w, height: n.h };
    const body = (
      <>
        <span className="map-node-name">{n.name}</span>
        {n.open ? null : <span className="map-node-line">{n.line}</span>}
      </>
    );
    return n.opens ? (
      <button
        key={n.id}
        type="button"
        className={cls}
        style={style}
        title={n.open ? `Close ${n.name}` : `Open ${n.name}`}
        aria-expanded={n.open}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(n.id);
        }}
      >
        {body}
      </button>
    ) : (
      <div key={n.id} className={cls} style={style}>
        {body}
      </div>
    );
  };
  return (
    <div
      ref={wrap}
      className="system-map"
      role="figure"
      aria-label="The system's repos and the calls between them"
    >
      <div style={{ width: fullW * scale, height: fullH * scale }}>
        <div
          className="system-map-canvas"
          style={{
            width: fullW,
            height: fullH,
            transform: `scale(${String(scale)})`,
            transformOrigin: "0 0",
          }}
        >
          {frames.map(node)}
          <svg
            className="system-map-lines"
            width={map.width + PAD * 2}
            height={map.height + PAD * 2}
          >
            {map.lines.map((l) => {
              const a = byId.get(l.from);
              const b = byId.get(l.to);
              if (!a || !b) return null;
              const p = path(a, b);
              return (
                <g
                  key={l.key}
                  className={`map-line${l.grey ? " grey" : ""}${l.guessed ? " guessed" : ""}${b.kind === "stub" ? " stub" : ""}`}
                  onClick={() => {
                    onLine(l);
                  }}
                >
                  <path d={p.d} className="map-line-hit" />
                  <path d={p.d} className="map-line-path" />
                  <text x={p.mx} y={p.my - 6} textAnchor="middle" className="map-line-label">
                    {l.label}
                  </text>
                </g>
              );
            })}
          </svg>
          {boxes.map(node)}
        </div>
      </div>
    </div>
  );
}
