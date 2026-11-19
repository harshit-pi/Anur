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
  /** Which of its parent's rows it sits in, from 0. */
  row?: number;
  /** For a parent: the y of each row's rail, top first. */
  rails?: number[];
  /** For a parent: the x of the spine joining its rows' rails. */
  spine?: number;
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
/** Between a parent's wrapped rows of children. */
const GAP_WRAP = 40;
/** Children per row under one parent, so a row fits the map at a readable zoom; more wrap. */
export const ROW_MAX = 4;

const chunk = <T>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * Every node placed, top down: the title at the top, each box's children in
 * rows of at most `ROW_MAX` beneath it, wrapping in reading order, every
 * parent centred over its rows. A wide doc grows down, never endlessly
 * sideways. Each parent records where its rows' rails run and the spine
 * that joins them, so lines can be drawn as a trunk, rails and drops.
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

  // A subtree's width and its height from its box's top.
  const size = new Map<string, { w: number; h: number }>();
  const rowsOf = (n: MapNode) => chunk(children.get(n.id) ?? [], ROW_MAX);
  const rowExtent = (row: readonly MapNode[]) => {
    const top = Math.max(...row.map((k) => k.h));
    return Math.max(...row.map((k) => (top - k.h) / 2 + (size.get(k.id)?.h ?? k.h)));
  };
  const measure = (n: MapNode): void => {
    const rows = rowsOf(n);
    for (const row of rows) for (const k of row) measure(k);
    let w = n.w;
    let h = n.h;
    rows.forEach((row, r) => {
      const rowW = row.reduce(
        (sum, k, i) => sum + (size.get(k.id)?.w ?? k.w) + (i > 0 ? GAP_COLUMN : 0),
        0,
      );
      w = Math.max(w, rowW);
      h += (r === 0 ? GAP_ROW : GAP_WRAP) + rowExtent(row);
    });
    size.set(n.id, { w, h });
  };
  measure(root);

  /** Place `n`'s box with its top at `top`, centred on `cx`, then its rows below. */
  const place = (n: MapNode, cx: number, top: number, row: number) => {
    const rows = rowsOf(n);
    const rails: number[] = [];
    let rowTop = top + n.h;
    let spine = cx;
    rows.forEach((kids, r) => {
      rowTop += r === 0 ? GAP_ROW : GAP_WRAP;
      rails.push(rowTop - (r === 0 ? GAP_ROW : GAP_WRAP) / 2);
      const boxTop = Math.max(...kids.map((k) => k.h));
      const rowW = kids.reduce(
        (sum, k, i) => sum + (size.get(k.id)?.w ?? k.w) + (i > 0 ? GAP_COLUMN : 0),
        0,
      );
      let cursor = cx - rowW / 2;
      // The spine runs down the left of the widest row, clear of every box.
      spine = Math.min(spine, cursor - GAP_COLUMN / 2);
      for (const k of kids) {
        const kw = size.get(k.id)?.w ?? k.w;
        place(k, cursor + kw / 2, rowTop + (boxTop - k.h) / 2, r);
        cursor += kw + GAP_COLUMN;
      }
      rowTop += rowExtent(kids);
    });
    placed.set(n.id, {
      id: n.id,
      x: cx,
      y: top + n.h / 2,
      w: n.w,
      h: n.h,
      side: n.parent === null ? 0 : 1,
      row,
      rails,
      spine,
    });
  };
  place(root, 0, -root.h / 2, 0);
  return placed;
}

/** Between a box and the column of its children, in the mind map. */
const GAP_DEPTH = 72;
/** Between stacked siblings, in the mind map. */
const GAP_STACK = 18;

/**
 * The mind map (mock 8): the title in the middle, its sections branching to
 * the right and the left, each box's children stacked beside it, further
 * out. The first half of the title's children, by height, go right and the
 * rest left, each side read top down. Lines run from a box's side to its
 * children's, so no parent records rails.
 */
export function mindLayout(nodes: readonly MapNode[]): Map<string, Placed> {
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
  // Right takes children in order until it holds half the height; left the rest.
  const total = stack(kids);
  const right: MapNode[] = [];
  let used = 0;
  for (const k of kids) {
    if (right.length > 0 && used >= total / 2) break;
    right.push(k);
    used += (height.get(k.id) ?? k.h) + GAP_STACK;
  }
  const left = kids.slice(right.length);
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
