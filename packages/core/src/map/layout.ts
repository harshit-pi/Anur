import { z } from "zod";
import { DeviceId } from "../ids.ts";

/**
 * The map's layout (task 7; Data Model, "The map"), as in Mock 3: the title
 * in the middle, its sections split to its right and left so both sides
 * weigh about the same, and each section's subsections further out on its
 * side, every subtree centred on its parent.
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
  /** Which side of the title it grows to: 1 right, -1 left, 0 the title itself. */
  side: -1 | 0 | 1;
};

const GAP_X = 72;
const GAP_Y = 18;

/** A box's size from its heading and first line, as the map draws them. */
export function boxSize(heading: string, firstLine: string): { w: number; h: number } {
  const longest = Math.max(heading.length, Math.min(firstLine.length, 40));
  const w = Math.max(140, Math.min(260, Math.round(longest * 7.2 + 32)));
  const perLine = Math.floor((w - 32) / 7.2);
  const headingLines = Math.max(1, Math.ceil(heading.length / perLine));
  const bodyLines = firstLine ? Math.min(2, Math.ceil(firstLine.length / (perLine * 1.1))) : 0;
  return { w, h: 20 + headingLines * 20 + bodyLines * 16 };
}

/** Every node placed; nodes are given parents first, in reading order. */
export function mapLayout(nodes: readonly MapNode[]): Map<string, Placed> {
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

  // How tall a subtree stands: its own box, or its children's stacked, whichever is taller.
  const span = new Map<string, number>();
  const measure = (n: MapNode): number => {
    const kids = children.get(n.id) ?? [];
    const stacked = kids.reduce((sum, k, i) => sum + measure(k) + (i > 0 ? GAP_Y : 0), 0);
    const s = Math.max(n.h, stacked);
    span.set(n.id, s);
    return s;
  };
  measure(root);

  // Split the title's sections into right and left, in reading order, the right side first.
  const top = children.get(root.id) ?? [];
  const total = top.reduce((sum, k) => sum + (span.get(k.id) ?? 0), 0);
  const right: MapNode[] = [];
  const left: MapNode[] = [];
  let acc = 0;
  for (const k of top) {
    const s = span.get(k.id) ?? 0;
    if (right.length === 0 || acc + s / 2 <= total / 2) {
      right.push(k);
      acc += s;
    } else left.push(k);
  }

  placed.set(root.id, { id: root.id, x: 0, y: 0, w: root.w, h: root.h, side: 0 });

  /** Place `n` with its subtree's top edge at `top`, `side` of a parent at `parentX` and width `parentW`. */
  const place = (n: MapNode, top: number, side: 1 | -1, parentX: number, parentW: number) => {
    const s = span.get(n.id) ?? n.h;
    const x = parentX + side * (parentW / 2 + GAP_X + n.w / 2);
    const y = top + s / 2;
    placed.set(n.id, { id: n.id, x, y, w: n.w, h: n.h, side });
    const kids = children.get(n.id) ?? [];
    const stacked = kids.reduce(
      (sum, k, i) => sum + (span.get(k.id) ?? 0) + (i > 0 ? GAP_Y : 0),
      0,
    );
    let cursor = y - stacked / 2;
    for (const k of kids) {
      place(k, cursor, side, x, n.w);
      cursor += (span.get(k.id) ?? 0) + GAP_Y;
    }
  };
  for (const [group, side] of [
    [right, 1],
    [left, -1],
  ] as const) {
    const stacked = group.reduce(
      (sum, k, i) => sum + (span.get(k.id) ?? 0) + (i > 0 ? GAP_Y : 0),
      0,
    );
    let cursor = -stacked / 2;
    for (const k of group) {
      place(k, cursor, side, 0, root.w);
      cursor += (span.get(k.id) ?? 0) + GAP_Y;
    }
  }
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
