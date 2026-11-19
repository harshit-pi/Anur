/**
 * The system as a map (24.4): repos as frames on a canvas, joined by the
 * edges found in code (group 22). A frame opens in place to show its groups
 * and parts, lines then attach to the part that calls or serves, and what
 * isn't joined to it goes grey. Pure, so the layout is the same every time
 * for the same code: positions come from IDs and edges, never from chance.
 */
import {
  childrenOf,
  endName,
  partIdsUnder,
  type SystemEdge,
  type SystemSection,
} from "./system-levels.ts";
import type { SystemIconKind } from "../icons/system/index.tsx";

export type MapNode = {
  id: string;
  kind: "repo" | "group" | "part" | "resource" | "stub";
  name: string;
  /** A second line: what it holds, or its build file. */
  line: string;
  x: number;
  y: number;
  w: number;
  h: number;
  open: boolean;
  /** Opens on a click: a repo or group with something inside. */
  opens: boolean;
  /** Not joined to what's open: drawn grey. */
  grey: boolean;
  /** Its parent frame on the map, for drawing nested. */
  parent: string | null;
  /** What it is, for its icon; null draws a plain box. */
  icon: SystemIconKind | null;
};

export type MapLine = {
  key: string;
  from: string;
  to: string;
  /** "67 calls", or the one call's route. */
  label: string;
  count: number;
  grey: boolean;
  guessed: boolean;
  /** The calls or links it stands for, for the card a click opens. */
  edges: SystemEdge[];
};

export type SystemMap = { nodes: MapNode[]; lines: MapLine[]; width: number; height: number };

const BOX_W = 210;
const BOX_H = 64;
const HEAD = 38;
const PAD = 20;
const GAP = 24;
/** Between boxes inside an open frame: room for a line's label between them. */
const GAP_X = 72;
const GAP_Y = 56;
const COL_GAP = 150;
const ROW_GAP = 40;

const plural = (n: number, one: string) => `${String(n)} ${n === 1 ? one : `${one}s`}`;

const GROUP_ICONS: Record<string, SystemIconKind> = {
  tables: "table",
  queues: "queue",
  storage: "bucket",
  topics: "topic",
  secrets: "secret",
  cache: "cache",
  monitoring: "monitor",
  schedules: "schedule",
};
const RESOURCE_ICONS = new Set<string>(["function", "table", "queue", "topic", "bucket"]);

/**
 * A box's icon from what the read already knows: a repo's GitHub remote, a
 * group's kind (tables, queues…), a part's build file, a resource's AWS kind.
 */
export function iconOf(sec: SystemSection | undefined): SystemIconKind | null {
  if (!sec) return null;
  const { id, text } = sec;
  if (id.startsWith("repo:")) return text.includes("/") ? "github" : "folder";
  if (id.startsWith("res:")) {
    const kind = id.slice(4).split(":")[0] ?? "";
    return RESOURCE_ICONS.has(kind) ? (kind as SystemIconKind) : null;
  }
  if (id.startsWith("part:"))
    return text.startsWith("stack ") ? "stack" : text.startsWith("package ") ? "package" : null;
  if (id.startsWith("group:")) {
    const key = id.slice(6).split("/")[1] ?? "";
    return GROUP_ICONS[key] ?? null;
  }
  return null;
}

type Sized = { id: string; w: number; h: number; kids: Sized[] };

/**
 * Lays out one owner's system (or the whole folder's when `scope` is null).
 * `open` holds the frames the person opened.
 */
export function layoutMap(
  all: readonly SystemSection[],
  edges: readonly SystemEdge[],
  scope: string | null,
  open: ReadonlySet<string>,
): SystemMap {
  const byId = new Map(all.map((s) => [s.id, s]));
  const repos = (scope ? childrenOf(all, scope) : childrenOf(all, null)).filter((s) =>
    s.id.startsWith("repo:"),
  );
  const inScope = new Set<string>();
  const mark = (id: string) => {
    inScope.add(id);
    for (const c of childrenOf(all, id)) mark(c.id);
  };
  for (const r of repos) mark(r.id);

  // What's visible: a repo, and inside an open frame its children, recursively.
  const visibleOf = (id: string): string => {
    // The nearest ancestor-or-self that is drawn: inside an open chain, else its repo.
    const chain: string[] = [];
    for (let at = byId.get(id); at; at = at.parent ? byId.get(at.parent) : undefined)
      chain.unshift(at.id);
    const start = chain.findIndex((x) => x.startsWith("repo:"));
    let shown = chain[start] ?? id;
    for (let i = start; i < chain.length - 1; i++) {
      if (!open.has(chain[i] ?? "")) break;
      shown = chain[i + 1] ?? shown;
    }
    return shown;
  };

  const size = (id: string): Sized => {
    const kids = childrenOf(all, id);
    if (!open.has(id) || !kids.length) return { id, w: BOX_W, h: BOX_H, kids: [] };
    const sized = kids.map((k) => size(k.id));
    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(sized.length))));
    const rows: Sized[][] = [];
    sized.forEach((s, i) => (rows[Math.floor(i / cols)] ??= []).push(s));
    const w =
      PAD * 2 +
      Math.max(...rows.map((r) => r.reduce((n, s) => n + s.w, 0) + GAP_X * (r.length - 1)));
    const h =
      HEAD +
      PAD +
      rows.reduce((n, r) => n + Math.max(...r.map((s) => s.h)), 0) +
      GAP_Y * (rows.length - 1);
    return { id, w, h, kids: sized };
  };

  // Lines between what's drawn, one per pair, from edges in scope.
  type Agg = { from: string; to: string; edges: SystemEdge[] };
  const agg = new Map<string, Agg>();
  const stubs = new Map<string, string>();
  // Many outside ends fold into one box each, "Outside services" and "Not in
  // these repos", so a long tail of tables doesn't crowd the map.
  const shown = edges.filter(
    (e) => e.state !== "hidden" && (inScope.has(e.from) || inScope.has(e.to)),
  );
  const outsideEnds = new Set(
    shown.filter((e) => e.to.startsWith("stub:outside:")).map((e) => e.to),
  );
  const missingEnds = new Set(
    shown.filter((e) => e.to.startsWith("stub:not-cloned:")).map((e) => e.to),
  );
  const fold = (id: string) =>
    id.startsWith("stub:outside:") && outsideEnds.size > 3
      ? "stub:many:outside"
      : id.startsWith("stub:not-cloned:") && missingEnds.size > 3
        ? "stub:many:not-cloned"
        : id;
  for (const e of shown) {
    const isStub = e.to.startsWith("stub:");
    const from = inScope.has(e.from) ? visibleOf(e.from) : `ext:${endName(all, e.from).name}`;
    const to = isStub
      ? fold(e.to)
      : inScope.has(e.to)
        ? visibleOf(e.to)
        : `ext:${endName(all, e.to).name}`;
    if (from === to) continue;
    if (isStub)
      stubs.set(
        to,
        to === "stub:many:outside"
          ? `${String(outsideEnds.size)} outside services`
          : to === "stub:many:not-cloned"
            ? `${String(missingEnds.size)} not in these repos`
            : endName(all, e.to).name,
      );
    if (from.startsWith("ext:")) stubs.set(from, from.slice(4));
    if (to.startsWith("ext:")) stubs.set(to, to.slice(4));
    const key = `${from}→${to}`;
    const a = agg.get(key) ?? { from, to, edges: [] };
    a.edges.push(e);
    agg.set(key, a);
  }

  // Columns by calls between repos: callers left, what they call to the right.
  const repoOf = (id: string) => {
    for (let at = byId.get(id); at; at = at.parent ? byId.get(at.parent) : undefined)
      if (at.id.startsWith("repo:")) return at.id;
    return id;
  };
  const calls = [...agg.values()]
    .map((a) => [repoOf(a.from), repoOf(a.to)] as const)
    .filter(([f, t]) => f !== t && repos.some((r) => r.id === f) && repos.some((r) => r.id === t));
  const rank = new Map(repos.map((r) => [r.id, 0]));
  for (let i = 0; i < repos.length; i++)
    for (const [f, t] of calls) rank.set(t, Math.max(rank.get(t) ?? 0, (rank.get(f) ?? 0) + 1));
  const linked = new Set(calls.flat());
  for (const a of agg.values()) {
    if (!a.from.startsWith("ext:") && !a.from.startsWith("stub:")) linked.add(repoOf(a.from));
    if (!a.to.startsWith("ext:") && !a.to.startsWith("stub:")) linked.add(repoOf(a.to));
  }

  const nodes: MapNode[] = [];
  const place = (s: Sized, x: number, y: number, parent: string | null) => {
    const sec = byId.get(s.id);
    const kids = childrenOf(all, s.id);
    const isRes = s.id.startsWith("res:");
    const isPart = s.id.startsWith("part:");
    const parts = isPart || isRes ? 1 : partIdsUnder(all, s.id).length;
    const groups = kids.filter((k) => !k.id.startsWith("part:") && !k.id.startsWith("res:")).length;
    nodes.push({
      id: s.id,
      kind: s.id.startsWith("repo:") ? "repo" : isRes ? "resource" : isPart ? "part" : "group",
      name: sec?.path.at(-1) ?? s.id,
      line: isRes
        ? (sec?.text ?? "")
        : isPart
          ? kids.length
            ? plural(kids.length, "resource")
            : (sec?.text ?? "")
          : !kids.length
            ? "No build file"
            : groups
              ? `${plural(parts, "part")} in ${plural(groups, "group")}`
              : plural(parts, "part"),
      x,
      y,
      w: s.w,
      h: s.h,
      open: open.has(s.id) && s.kids.length > 0,
      opens: !isRes && kids.length > 0,
      grey: false,
      parent,
      icon: iconOf(sec),
    });
    if (!s.kids.length) return;
    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(s.kids.length))));
    let cy = y + HEAD;
    for (let i = 0; i < s.kids.length; i += cols) {
      const row = s.kids.slice(i, i + cols);
      let cx = x + PAD;
      for (const k of row) {
        place(k, cx, cy, s.id);
        cx += k.w + GAP_X;
      }
      cy += Math.max(...row.map((k) => k.h)) + GAP_Y;
    }
  };

  // Linked repos in columns by rank; each outside service in the column just
  // right of its caller, under that column's repos, so no line runs behind a box.
  const columns: string[][] = [];
  for (const r of repos) if (linked.has(r.id)) (columns[rank.get(r.id) ?? 0] ??= []).push(r.id);
  const stubCol = new Map<string, number>();
  for (const a of agg.values()) {
    const end =
      a.to.startsWith("stub:") || a.to.startsWith("ext:")
        ? a.to
        : a.from.startsWith("ext:")
          ? a.from
          : null;
    if (!end) continue;
    const other = end === a.to ? a.from : a.to;
    const col = (rank.get(repoOf(other)) ?? 0) + 1;
    stubCol.set(end, Math.max(stubCol.get(end) ?? 0, col));
  }
  const colCount = Math.max(columns.length, ...[...stubCol.values()].map((c) => c + 1), 0);
  let x = 0;
  let bottom = 0;
  for (let c = 0; c < colCount; c++) {
    const col = columns[c] ?? [];
    const mine = [...stubs]
      .filter(([id]) => stubCol.get(id) === c)
      .sort((a, b) => a[1].localeCompare(b[1]));
    if (!col.length && !mine.length) continue;
    let y = 0;
    let colW = 0;
    for (const id of col) {
      const s = size(id);
      place(s, x, y, null);
      y += s.h + ROW_GAP;
      colW = Math.max(colW, s.w);
    }
    for (const [id, full] of mine) {
      // "table PremiumUsers": the kind gives the icon, the rest the name.
      const typed = /^(function|table|queue|topic|bucket) (.+)$/.exec(full);
      nodes.push({
        id,
        kind: "stub",
        name: typed?.[2] ?? full,
        line:
          id === "stub:many:outside"
            ? "outside"
            : typed
              ? // A table or queue a repo here uses by name: its name says it all.
                ""
              : id === "stub:many:not-cloned"
                ? "created in no repo here"
                : id.startsWith("stub:not-cloned")
                  ? "not cloned"
                  : id.startsWith("ext:")
                    ? "another system"
                    : "outside",
        x,
        y,
        w: BOX_W,
        h: BOX_H,
        open: false,
        opens: false,
        grey: false,
        parent: null,
        icon: (typed?.[1] as SystemIconKind | undefined) ?? null,
      });
      y += BOX_H + 14;
      colW = Math.max(colW, BOX_W);
    }
    bottom = Math.max(bottom, y);
    x += colW + COL_GAP;
  }
  const right = x - COL_GAP;
  // Repos with no lines: a row underneath, wrapping at the map's width.
  const loose = repos.filter((r) => !linked.has(r.id)).map((r) => size(r.id));
  let lx = 0;
  let ly = bottom + (bottom ? 40 : 0);
  let rowH = 0;
  const wrap = Math.max(right, BOX_W * 4 + GAP * 3);
  for (const s of loose) {
    if (lx > 0 && lx + s.w > wrap) {
      lx = 0;
      ly += rowH + GAP;
      rowH = 0;
    }
    place(s, lx, ly, null);
    lx += s.w + GAP;
    rowH = Math.max(rowH, s.h);
  }

  // Grey what isn't joined to an open frame, when one is open.
  const openRoots = repos.filter((r) => open.has(r.id)).map((r) => r.id);
  if (openRoots.length) {
    const lit = new Set(openRoots);
    for (const a of agg.values()) {
      const f = repoOf(a.from);
      const t = a.to.startsWith("stub:") || a.to.startsWith("ext:") ? a.to : repoOf(a.to);
      if (lit.has(f)) lit.add(t);
      if (lit.has(t)) lit.add(f);
    }
    for (const n of nodes) {
      const root = n.kind === "stub" ? n.id : repoOf(n.id);
      n.grey = !lit.has(root);
    }
  }

  const greyOf = new Map(nodes.map((n) => [n.id, n.grey]));
  const lines: MapLine[] = [...agg.entries()].map(([key, a]) => ({
    key,
    from: a.from,
    to: a.to,
    count: a.edges.length,
    // One call names its route; "/" alone says nothing, so it isn't drawn.
    label:
      a.edges.length === 1
        ? a.edges[0]?.label === "/"
          ? ""
          : (a.edges[0]?.label ?? "")
        : plural(a.edges.length, a.edges.every((e) => e.kind === "http") ? "call" : "link"),
    grey: !!(greyOf.get(a.from) || greyOf.get(a.to)),
    guessed: a.edges.some((e) => e.how === "guessed" && e.state === "shown"),
    edges: a.edges,
  }));
  const width = Math.max(0, ...nodes.map((n) => n.x + n.w));
  const height = Math.max(0, ...nodes.map((n) => n.y + n.h));
  return { nodes, lines, width, height };
}

export type Route = { d: string; mx: number; my: number };
type Box = { id: string; x: number; y: number; w: number; h: number };
type Side = "left" | "right" | "top" | "bottom";

/**
 * Where each line runs, tidily: it leaves and enters by the sides that face
 * each other (top and bottom for boxes stacked in a column), and lines on
 * one side are spread along it, ordered by where they go, so they don't
 * all leave from one point and cross.
 */
export function routeLines(
  boxes: readonly Box[],
  lines: readonly { key: string; from: string; to: string }[],
): Map<string, Route> {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  type End = { key: string; box: Box; side: Side; other: Box };
  const ends: End[] = [];
  const sides = new Map<string, [Side, Side]>();
  for (const l of lines) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) continue;
    const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
    const pair: [Side, Side] = overlapX
      ? b.y >= a.y + a.h / 2
        ? ["bottom", "top"]
        : ["top", "bottom"]
      : b.x >= a.x + a.w / 2
        ? ["right", "left"]
        : ["left", "right"];
    sides.set(l.key, pair);
    ends.push({ key: `${l.key}|from`, box: a, side: pair[0], other: b });
    ends.push({ key: `${l.key}|to`, box: b, side: pair[1], other: a });
  }
  // Spread the ends on each side of a box, ordered by where their other box is.
  const at = new Map<string, { x: number; y: number }>();
  const groups = new Map<string, End[]>();
  for (const e of ends) {
    const k = `${e.box.id}|${e.side}`;
    const g = groups.get(k) ?? [];
    g.push(e);
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    const first = g[0];
    if (!first) continue;
    const { box, side } = first;
    const vertical = side === "left" || side === "right";
    g.sort((p, q) =>
      vertical ? p.other.y + p.other.h / 2 - (q.other.y + q.other.h / 2) : p.other.x - q.other.x,
    );
    // A frame's ends stay near its head, where its name is.
    const span = vertical ? Math.min(box.h, 64) : box.w;
    g.forEach((e, i) => {
      const t = (i + 1) / (g.length + 1);
      at.set(
        e.key,
        side === "left"
          ? { x: box.x, y: box.y + span * t }
          : side === "right"
            ? { x: box.x + box.w, y: box.y + span * t }
            : side === "top"
              ? { x: box.x + box.w * t, y: box.y }
              : { x: box.x + box.w * t, y: box.y + box.h },
      );
    });
  }
  const out = new Map<string, Route>();
  for (const l of lines) {
    const pair = sides.get(l.key);
    const p = at.get(`${l.key}|from`);
    const q = at.get(`${l.key}|to`);
    if (!pair || !p || !q) continue;
    const pull = (s: Side, d: number) =>
      s === "left" ? [-d, 0] : s === "right" ? [d, 0] : s === "top" ? [0, -d] : [0, d];
    const dist = Math.hypot(q.x - p.x, q.y - p.y);
    const d = Math.max(16, Math.min(160, dist / 2.5));
    const [ax, ay] = pull(pair[0], d);
    const [bx, by] = pull(pair[1], d);
    const n = (v: number) => String(Math.round(v * 10) / 10);
    out.set(l.key, {
      d: `M${n(p.x)},${n(p.y)} C${n(p.x + (ax ?? 0))},${n(p.y + (ay ?? 0))} ${n(q.x + (bx ?? 0))},${n(q.y + (by ?? 0))} ${n(q.x)},${n(q.y)}`,
      mx: (p.x + q.x) / 2,
      my: (p.y + q.y) / 2,
    });
  }
  return out;
}

/**
 * Lines whose two ends sit inside the same open frame: a repo's own links
 * between its groups. They show when the person points at one of their ends,
 * so an open repo isn't a knot of its own wiring.
 */
export function innerLines(
  nodes: readonly { id: string; parent: string | null }[],
  lines: readonly { key: string; from: string; to: string }[],
): Set<string> {
  const parent = new Map(nodes.map((n) => [n.id, n.parent]));
  const root = (id: string) => {
    let at = id;
    for (let up = parent.get(at); up; up = parent.get(at)) at = up;
    return at;
  };
  const out = new Set<string>();
  for (const l of lines) {
    if (!parent.has(l.from) || !parent.has(l.to)) continue;
    const r = root(l.from);
    if (r !== l.from && r !== l.to && r === root(l.to)) out.add(l.key);
  }
  return out;
}
