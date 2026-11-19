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

export type MapNode = {
  id: string;
  kind: "repo" | "group" | "part" | "stub";
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
};

export type SystemMap = { nodes: MapNode[]; lines: MapLine[]; width: number; height: number };

const BOX_W = 210;
const BOX_H = 64;
const HEAD = 34;
const PAD = 14;
const GAP = 12;
const COL_GAP = 110;
const ROW_GAP = 26;

const plural = (n: number, one: string) => `${String(n)} ${n === 1 ? one : `${one}s`}`;

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
      PAD * 2 + Math.max(...rows.map((r) => r.reduce((n, s) => n + s.w, 0) + GAP * (r.length - 1)));
    const h =
      HEAD +
      PAD +
      rows.reduce((n, r) => n + Math.max(...r.map((s) => s.h)), 0) +
      GAP * (rows.length - 1);
    return { id, w, h, kids: sized };
  };

  // Lines between what's drawn, one per pair, from edges in scope.
  type Agg = { from: string; to: string; edges: SystemEdge[] };
  const agg = new Map<string, Agg>();
  const stubs = new Map<string, string>();
  for (const e of edges) {
    if (e.state === "hidden") continue;
    if (!inScope.has(e.from) && !inScope.has(e.to)) continue;
    const isStub = e.to.startsWith("stub:");
    const from = inScope.has(e.from) ? visibleOf(e.from) : `ext:${endName(all, e.from).name}`;
    const to = isStub
      ? e.to
      : inScope.has(e.to)
        ? visibleOf(e.to)
        : `ext:${endName(all, e.to).name}`;
    if (from === to) continue;
    if (isStub) stubs.set(e.to, endName(all, e.to).name);
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
    const isPart = s.id.startsWith("part:");
    const parts = isPart ? 1 : partIdsUnder(all, s.id).length;
    const groups = kids.filter((k) => !k.id.startsWith("part:")).length;
    nodes.push({
      id: s.id,
      kind: s.id.startsWith("repo:") ? "repo" : isPart ? "part" : "group",
      name: sec?.path.at(-1) ?? s.id,
      line: isPart
        ? (sec?.text ?? "")
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
      opens: !isPart && kids.length > 0,
      grey: false,
      parent,
    });
    if (!s.kids.length) return;
    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(s.kids.length))));
    let cy = y + HEAD;
    for (let i = 0; i < s.kids.length; i += cols) {
      const row = s.kids.slice(i, i + cols);
      let cx = x + PAD;
      for (const k of row) {
        place(k, cx, cy, s.id);
        cx += k.w + GAP;
      }
      cy += Math.max(...row.map((k) => k.h)) + GAP;
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
    for (const [id, name] of mine) {
      nodes.push({
        id,
        kind: "stub",
        name,
        line: id.startsWith("stub:not-cloned")
          ? "not cloned"
          : id.startsWith("ext:")
            ? "another system"
            : "outside",
        x,
        y,
        w: BOX_W,
        h: 52,
        open: false,
        opens: false,
        grey: false,
        parent: null,
      });
      y += 52 + 14;
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
        : plural(a.edges.length, "call"),
    grey: !!(greyOf.get(a.from) || greyOf.get(a.to)),
    guessed: a.edges.some((e) => e.how === "guessed" && e.state === "shown"),
  }));
  const width = Math.max(0, ...nodes.map((n) => n.x + n.w));
  const height = Math.max(0, ...nodes.map((n) => n.y + n.h));
  return { nodes, lines, width, height };
}
