import { z } from "zod";
import { DeviceId } from "../ids.ts";

/**
 * The map's layout (task 7; Data Model, "The map"): a mind map, the title in
 * the middle and its sections branching to both sides.
 *
 * Box sizes come from the text, never from the screen, so fonts and zoom
 * can't move a box, and the same tree always gives the same picture. A box
 * a person drags keeps its place, kept in `docs/<doc>/layout/<device>.json`
 * by section ID; the layout places every box, and the page draws a moved
 * one where it was put.
 */

export type MapNode = {
  id: string;
  /** null for the root, the doc's title. */
  parent: string | null;
  w: number;
  h: number;
};

export type Placed = {
  id: string;
  /** The box's centre, in map units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0 for the title; 1 right of it, -1 left. */
  side: -1 | 0 | 1;
};

/** A box's size from its heading and second line, as the map draws them. */
export function boxSize(heading: string, firstLine: string): { w: number; h: number } {
  const longest = Math.max(heading.length, Math.min(firstLine.length, 24));
  const w = Math.max(160, Math.min(280, Math.round(longest * 8.4 + 40)));
  const perLine = Math.floor((w - 40) / 8.4);
  const headingLines = Math.max(1, Math.ceil(heading.length / perLine));
  const bodyLines = firstLine ? Math.min(2, Math.ceil(firstLine.length / (perLine * 1.1))) : 0;
  return { w, h: 28 + headingLines * 22 + bodyLines * 20 + (bodyLines ? 4 : 0) };
}

/** Between a box and the column of its children, in the mind map. */
const GAP_DEPTH = 72;
/** Between stacked siblings, in the mind map. */
const GAP_STACK = 18;

/**
 * The sides the title's children keep in the next mind map (30.35): each its
 * own, else the side its boxes had before. A section made by Use takes the
 * side its choices were on, so the map doesn't swap round under the person.
 * `seen` is every box's side in the last mind map.
 */
export function keptSides(
  nodes: readonly MapNode[],
  seen: ReadonlyMap<string, -1 | 1>,
): Map<string, -1 | 1> {
  const root = nodes.find((n) => n.parent === null);
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parent === null) continue;
    const list = kids.get(n.parent) ?? [];
    list.push(n.id);
    kids.set(n.parent, list);
  }
  /** The side the first box seen before under `id` had, nearest first. */
  const inherited = (id: string): -1 | 1 | undefined => {
    const queue = [...(kids.get(id) ?? [])];
    for (let k = 0; k < queue.length; k++) {
      const at = queue[k] ?? "";
      const side = seen.get(at);
      if (side) return side;
      queue.push(...(kids.get(at) ?? []));
    }
    return undefined;
  };
  const out = new Map<string, -1 | 1>();
  if (!root || seen.size === 0) return out;
  for (const id of kids.get(root.id) ?? []) {
    const side = seen.get(id) ?? inherited(id);
    if (side) out.set(id, side);
  }
  return out;
}

/**
 * The mind map (mock 8): the title in the middle, its sections branching to
 * the right and the left, each box's children stacked beside it, further
 * out. The first half of the title's children, by height, go right and the
 * rest left, each side read top down. Lines run from a box's side to its
 * children's.
 */
export function mindLayout(
  nodes: readonly MapNode[],
  /** Sides the title's children had before: they keep them, so adding a box moves no other. */
  kept: ReadonlyMap<string, -1 | 1> = new Map(),
): Map<string, Placed> {
  const children = new Map<string, MapNode[]>();
  for (const n of nodes) {
    if (n.parent === null) continue;
    const list = children.get(n.parent) ?? [];
    list.push(n);
    children.set(n.parent, list);
  }
  const root = nodes.find((n) => n.parent === null);
  const placed = new Map<string, Placed>();
  if (!root) return placed;

  // A subtree's height: its box, or its children stacked, whichever is taller.
  const height = new Map<string, number>();
  const stack = (kids: readonly MapNode[]) =>
    kids.reduce((sum, k, i) => sum + (height.get(k.id) ?? k.h) + (i > 0 ? GAP_STACK : 0), 0);
  const measure = (n: MapNode): void => {
    const kids = children.get(n.id) ?? [];
    for (const k of kids) measure(k);
    height.set(n.id, Math.max(n.h, stack(kids)));
  };
  measure(root);

  /** Place `n` beside its parent: its inner edge at `edge`, centred on `cy`. */
  const place = (n: MapNode, side: -1 | 1, edge: number, cy: number) => {
    const cx = edge + (side * n.w) / 2;
    placed.set(n.id, { id: n.id, x: cx, y: cy, w: n.w, h: n.h, side });
    column(children.get(n.id) ?? [], side, cx + (side * n.w) / 2 + side * GAP_DEPTH, cy);
  };
  const column = (kids: readonly MapNode[], side: -1 | 1, edge: number, cy: number) => {
    let top = cy - stack(kids) / 2;
    for (const k of kids) {
      const h = height.get(k.id) ?? k.h;
      place(k, side, edge, top + h / 2);
      top += h + GAP_STACK;
    }
  };

  placed.set(root.id, { id: root.id, x: 0, y: 0, w: root.w, h: root.h, side: 0 });
  const kids = children.get(root.id) ?? [];
  // A child keeps the side it had. With none kept, right takes children in
  // order until it holds half the height, left the rest; a new child joins
  // the side holding less.
  const sideOf = new Map<string, -1 | 1>();
  if (kids.every((k) => !kept.has(k.id))) {
    const total = stack(kids);
    let used = 0;
    let onRight = 0;
    for (const k of kids) {
      const side = onRight > 0 && used >= total / 2 ? -1 : 1;
      if (side === 1) {
        onRight++;
        used += (height.get(k.id) ?? k.h) + GAP_STACK;
      }
      sideOf.set(k.id, side);
    }
  } else {
    const load = { [-1]: 0, [1]: 0 } as Record<-1 | 1, number>;
    for (const k of kids) {
      const side = kept.get(k.id);
      if (side) load[side] += (height.get(k.id) ?? k.h) + GAP_STACK;
    }
    for (const k of kids) {
      let side = kept.get(k.id);
      if (!side) {
        side = load[1] <= load[-1] ? 1 : -1;
        load[side] += (height.get(k.id) ?? k.h) + GAP_STACK;
      }
      sideOf.set(k.id, side);
    }
  }
  const right = kids.filter((k) => sideOf.get(k.id) === 1);
  const left = kids.filter((k) => sideOf.get(k.id) === -1);
  column(right, 1, root.w / 2 + GAP_DEPTH, 0);
  column(left, -1, -root.w / 2 - GAP_DEPTH, 0);
  return placed;
}

/**
 * `docs/<doc>/layout/<device>.json`: where a person put boxes, by section
 * ID, in map units. Across devices the newest file wins.
 */
export const MapLayoutFile = z.object({
  at: z.iso.datetime({ precision: 3 }),
  dev: DeviceId,
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
});
export type MapLayoutFile = z.infer<typeof MapLayoutFile>;
