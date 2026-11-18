import { z } from "zod";
import { DeviceId } from "../ids.ts";

/**
 * The map's layout (task 7; Data Model, "The map"): a tree read top down,
 * the title at the top, each box's sections, threads and options in a row
 * beneath it, every subtree centred under its parent.
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
  /** 0 for the title; 1 for every box below it. */
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

const GAP_COLUMN = 28;
const GAP_ROW = 64;

/**
 * Every node placed, top down: the title at the top, its sections in a row
 * beneath it, and each box's children in a row beneath it, every parent
 * centred over its children. Rows are by depth, so a row's boxes line up.
 * Nodes are given parents first, in reading order.
 */
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

  // How wide a subtree is: its own box, or its children side by side, whichever is wider.
  const width = new Map<string, number>();
  const rowHeight: number[] = [];
  const measure = (n: MapNode, depth: number): number => {
    rowHeight[depth] = Math.max(rowHeight[depth] ?? 0, n.h);
    const kids = children.get(n.id) ?? [];
    const row = kids.reduce(
      (sum, k, i) => sum + measure(k, depth + 1) + (i > 0 ? GAP_COLUMN : 0),
      0,
    );
    const w = Math.max(n.w, row);
    width.set(n.id, w);
    return w;
  };
  measure(root, 0);
  // Each row's centre line, from the title's down.
  const rowY: number[] = [0];
  for (let d = 1; d < rowHeight.length; d++)
    rowY[d] = (rowY[d - 1] ?? 0) + (rowHeight[d - 1] ?? 0) / 2 + GAP_ROW + (rowHeight[d] ?? 0) / 2;

  /** Place `n` with its subtree's left edge at `left`. */
  const place = (n: MapNode, left: number, depth: number) => {
    const w = width.get(n.id) ?? n.w;
    const x = left + w / 2;
    placed.set(n.id, {
      id: n.id,
      x,
      y: rowY[depth] ?? 0,
      w: n.w,
      h: n.h,
      side: depth === 0 ? 0 : 1,
    });
    const kids = children.get(n.id) ?? [];
    const row = kids.reduce(
      (sum, k, i) => sum + (width.get(k.id) ?? 0) + (i > 0 ? GAP_COLUMN : 0),
      0,
    );
    let cursor = x - row / 2;
    for (const k of kids) {
      place(k, cursor, depth + 1);
      cursor += (width.get(k.id) ?? 0) + GAP_COLUMN;
    }
  };
  place(root, -(width.get(root.id) ?? root.w) / 2, 0);
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
