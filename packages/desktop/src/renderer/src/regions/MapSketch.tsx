import { memo } from "react";
import rough from "roughjs";

/**
 * The map's hand-drawn style: shapes and lines drawn as Excalidraw draws them
 * (rough.js). A box's outline stretches to the box's real size; each shape
 * keeps its own seed, so it never wobbles as the map redraws.
 */

const gen = rough.generator();

const seedOf = (id: string) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 2 ** 31 || 1;
};

const roundRect = (w: number, h: number, r: number) =>
  `M ${String(r)} 1 H ${String(w - r)} Q ${String(w - 1)} 1 ${String(w - 1)} ${String(r)} V ${String(h - r)} Q ${String(w - 1)} ${String(h - 1)} ${String(w - r)} ${String(h - 1)} H ${String(r)} Q 1 ${String(h - 1)} 1 ${String(h - r)} V ${String(r)} Q 1 1 ${String(r)} 1 Z`;

/** A box's sketched outline, inside the box, in its --sketch colour. */
export const BoxSketch = memo(function BoxSketch({
  id,
  w,
  h,
  dashed,
}: {
  id: string;
  w: number;
  h: number;
  dashed: boolean;
}) {
  const r = Math.min(14, h / 2);
  const shape = gen.path(roundRect(w, h, r), {
    seed: seedOf(id),
    roughness: 1.1,
    bowing: 1,
    strokeWidth: 1.5,
    ...(dashed ? { strokeLineDash: [6, 5] } : {}),
  });
  return (
    <svg
      className="map-sketch"
      viewBox={`0 0 ${String(w)} ${String(h)}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {gen.toPaths(shape).map((p, i) => (
        <path key={i} d={p.d} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
});

/** A line's path, redrawn sketchy: the d strings to draw in its place. */
export function sketchLine(id: string, d: string, dashed: boolean): string[] {
  const shape = gen.path(d, {
    seed: seedOf(id),
    roughness: 0.9,
    bowing: 1.2,
    ...(dashed ? { strokeLineDash: [6, 5] } : {}),
  });
  return gen.toPaths(shape).map((p) => p.d);
}
