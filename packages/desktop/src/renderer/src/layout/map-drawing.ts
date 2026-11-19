/**
 * The map as an Excalidraw drawing ("Open as drawing"): a box per section,
 * thread, option and edit, labelled as on the map, and an arrow from each
 * box's parent and for each link. It's a copy to sketch on: the map stays
 * the live view of the doc.
 */

export type MapShape = {
  id: string;
  kind: "section" | "thread" | "option" | "edit" | "link";
  x: number;
  y: number;
  w: number;
  h: number;
  heading: string;
  sub?: string | undefined;
  parent: string | null;
};

/** Excalidraw's skeleton elements, as convertToExcalidrawElements takes them. */
export type Skeleton = Record<string, unknown>;

const LOOK: Record<MapShape["kind"], { stroke: string; fill: string; dashed: boolean }> = {
  section: { stroke: "#1e1e1e", fill: "#ffffff", dashed: false },
  thread: { stroke: "#1971c2", fill: "#e7f5ff", dashed: true },
  option: { stroke: "#1971c2", fill: "#ffffff", dashed: true },
  edit: { stroke: "#e8590c", fill: "#fff4e6", dashed: true },
  link: { stroke: "#868e96", fill: "#f8f9fa", dashed: false },
};

export function mapSkeleton(
  shapes: readonly MapShape[],
  links: readonly { from: string; to: string }[],
): Skeleton[] {
  // Excalidraw's hand-drawn font is wider than the map's: each box grows to fit its words.
  const fit = (s: MapShape): MapShape => {
    const size = s.kind === "section" ? 18 : 15;
    const lines = (s.sub ? `${s.heading}\n${s.sub}` : s.heading).split("\n");
    const widest = Math.max(...lines.map((l) => l.length));
    const w = Math.max(s.w, Math.round(widest * size * 0.62 + 40));
    const h = Math.max(s.h, Math.round(lines.length * size * 1.35 + 24));
    return { ...s, w, h };
  };
  // Grown boxes push apart: positions scale by how much the boxes grew, so none touch.
  const grown = shapes.map(fit);
  const kx = Math.max(1, ...grown.map((g, i) => g.w / (shapes[i]?.w ?? g.w)));
  const ky = Math.max(1, ...grown.map((g, i) => g.h / (shapes[i]?.h ?? g.h)));
  const fitted = grown.map((g) => ({ ...g, x: g.x * kx, y: g.y * ky }));
  const byId = new Map(fitted.map((s) => [s.id, s]));
  const out: Skeleton[] = [];
  for (const s of fitted) {
    const look = LOOK[s.kind];
    out.push({
      type: "rectangle",
      id: s.id,
      x: Math.round(s.x - s.w / 2),
      y: Math.round(s.y - s.h / 2),
      width: Math.round(s.w),
      height: Math.round(Math.max(s.h, 44)),
      strokeColor: look.stroke,
      backgroundColor: look.fill,
      fillStyle: "solid",
      strokeStyle: look.dashed ? "dashed" : "solid",
      roundness: { type: 3 },
      label: {
        text: s.sub ? `${s.heading}\n${s.sub}` : s.heading,
        fontSize: s.kind === "section" ? 18 : 15,
        strokeColor: "#1e1e1e",
      },
    });
  }
  const arrow = (from: MapShape, to: MapShape, dashed: boolean, color: string) => {
    // Side by side, from side to side; else from the bottom to the top (or the reverse).
    const sideBySide = Math.abs(to.y - from.y) < (from.h + to.h) / 2;
    const right = to.x >= from.x ? 1 : -1;
    const down = to.y >= from.y ? 1 : -1;
    const x1 = sideBySide ? from.x + (right * from.w) / 2 : from.x;
    const y1 = sideBySide ? from.y : from.y + (down * from.h) / 2;
    const x2 = sideBySide ? to.x - (right * to.w) / 2 : to.x;
    const y2 = sideBySide ? to.y : to.y - (down * to.h) / 2;
    return {
      type: "arrow",
      x: Math.round(x1),
      y: Math.round(y1),
      points: [
        [0, 0],
        [Math.round(x2 - x1), Math.round(y2 - y1)],
      ],
      strokeColor: color,
      strokeStyle: dashed ? "dashed" : "solid",
      start: { id: from.id },
      end: { id: to.id },
    };
  };
  for (const s of fitted) {
    const p = s.parent ? byId.get(s.parent) : undefined;
    if (p) out.push(arrow(p, s, s.kind !== "section", "#495057"));
  }
  for (const l of links) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (a && b) out.push(arrow(a, b, true, "#868e96"));
  }
  return out;
}
