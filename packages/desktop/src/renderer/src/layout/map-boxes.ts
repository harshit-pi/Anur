/**
 * The doc map's boxes (task 7; Mock 3), worked out from the doc, its threads
 * and the person's moves: pure, so MapView only draws what this returns.
 */
import {
  boxSize,
  keptSides,
  mindLayout,
  resolveWiki,
  samePath,
  withoutHeading,
  type MapNode,
  type SectionTree,
} from "@anur/core";
import type { PreviewView, ThreadView } from "../../../shared/ipc-contract.ts";
import type { BoxStatus } from "./box-status.ts";
import { changeSummary } from "./change-summary.ts";
import { ownOffsets } from "./map-moves.ts";
import { sectionOf } from "./map-room.ts";
import { sidesSeen, withNames } from "./map-sides.ts";
import { actionWaits } from "../regions/action-waits.ts";

export type Pos = { x: number; y: number };
export type Box = {
  id: string;
  kind: "section" | "thread" | "option" | "edit" | "link" | "action";
  /** A link from this section to another doc's section (8.6). */
  link?: { doc: string | null; heading: string | null; written: string };
  index: number;
  thread?: ThreadView;
  /** An option a thread offered for this section, not picked yet. */
  option?: { id: string; title: string; text: string };
  /** The person is exploring this option before picking. */
  explored?: boolean;
  /** The agent is working on this option now. */
  exploring?: boolean;
  /** An option passed over when another was picked: shown when its fold is open. */
  notPicked?: boolean;
  /** One of a set of parts that all belong: Add, not Use, and nothing to explore. */
  several?: boolean;
  /** A part the person skipped, shown when its fold is open. */
  skipped?: boolean;
  /**
   * An action (Mock 10): a Build or Check thread, or one a thread proposed
   * and hasn't run. Its state, a few words, and the thread behind it.
   */
  act?: {
    state: "planned" | "running" | "needs" | "done" | "failed" | "stopped";
    tag: "BUILD" | "CHECK";
    detail: string;
    ask: { request: string; option: string } | null;
    /** For a planned one: the thread that proposed it, and its ID. */
    proposal?: { thread: string; action: string };
    /** For a planned one: what it will do, shown on hover. */
    what?: string;
    /** For a planned one that can't run yet: why (30.26). */
    waits?: string | null;
  };
  /** For a section: its lane of work, and the lane's height under the box. */
  lane?: LanePill[];
  laneH?: number;
  /** The title's lane, wider than its box: centred under it, inside the room the layout made. */
  laneCentred?: boolean;
  /** For a section whose lane is wider than it: its own width. */
  boxW?: number;
  /** For a section: threads with nothing drawn off them yet, shown as a 💬 count. */
  chats?: ThreadView[];
  /** For a label naming one of a thread's choices: that choice's heading, shown instead of the thread's title. */
  label?: string;
  /** The chip folding a made choice's other options, and whether it's open. */
  fold?: { open: boolean; count: number };
  /** The box's second line: what's under it, or what sets it apart. */
  sub?: string;
  /** What happened on a section's box, from its threads (mock 9). */
  status?: BoxStatus | null;
  /** A section's links to other docs (8.6), shown as one badge with a list. */
  outLinks?: { doc: string | null; heading: string | null; label: string }[];
  /** Moved off the layout by a drag: its lines go back to curves. */
  shifted?: boolean;
  heading: string;
  x: number;
  y: number;
  w: number;
  h: number;
  side: -1 | 0 | 1;
  parent: string | null;
};

/** A thread's pill: as wide as its name needs, within bounds. */
export const pill = (title: string, marks = 0) => ({
  w: Math.max(150, Math.min(320, Math.round(title.length * 7.8 + 44 + marks * 18))),
  h: 36,
});
let measurer: CanvasRenderingContext2D | null = null;
/**
 * A thread is italic text on its line (Mock 11): its slot is as wide as its
 * words, so the lines meet them instead of stopping short of a guessed width.
 */
export const labelWidth = (title: string) => {
  if (typeof document === "undefined") return pill(title).w;
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return pill(title).w;
  // The page's own font, once it has loaded; until then a serif close to it.
  const font = getComputedStyle(document.documentElement).getPropertyValue("--font-doc").trim();
  measurer.font = `italic 13px ${font || "serif"}`;
  // The label's padding (6px a side), and a pixel so the last letter never wraps.
  return Math.min(360, Math.ceil(measurer.measureText(title).width) + 14);
};
/**
 * A section box's size: room for its name beside the links badge, and for
 * the status chip beside the thread count on one line, so neither wraps a
 * word in two. The layout's height is an estimate; the box draws at its own.
 */
export const sectionSize = (
  heading: string,
  status: BoxStatus | null,
  sub: string,
  links: number,
) => {
  const base = boxSize(heading, sub);
  const name = Math.round(heading.length * 8.4 + 40 + (links > 0 ? 52 : 0));
  const line = Math.round(
    40 + (status ? status.label.length * 6.6 + 24 : 0) + (sub ? sub.length * 6.8 + 8 : 0),
  );
  return {
    w: Math.min(340, Math.max(base.w, Math.min(name, 300), line)),
    h: base.h + (status ? 6 : 0),
  };
};

/** One row of a section's lane (Mock 11): a pill. */
export const LANE_ROW = 30;

export type ActionState = "planned" | "running" | "needs" | "done" | "failed" | "stopped";

/** A piece of work under a section: a Build or Check thread, or an action a thread proposed. */
export type LaneItem = {
  key: string;
  state: ActionState;
  title: string;
  thread: ThreadView;
  detail: string;
  ask: { request: string; option: string } | null;
  proposal?: { thread: string; action: string };
  /** The service the agent said will do it, for its mark before it runs. */
  service?: string | null;
  /** Planned but not runnable yet: what it waits on (30.26). */
  waits?: string | null;
};

/** What the lane draws: one pill per item, or a folded group of planned or done ones. */
export type LanePill =
  | { kind: "item"; item: LaneItem; indent: boolean }
  | {
      kind: "group";
      state: "planned" | "done";
      count: number;
      key: string;
      open: boolean;
      /** Planned ones that can run now: Run all shows while there are any (30.28). */
      ready: LaneItem[];
      /** Every planned one, in order: Run all runs them all, each after the one before. */
      planned: LaneItem[];
    };

/**
 * The lane's pills: what's under way, waiting or failed, each on its own;
 * planned and done ones folded into "▶ N planned" and "✓ N done" when more
 * than one, opening on a click to each by name.
 */
export function lanePills(lane: readonly LaneItem[], section: string, open: ReadonlySet<string>) {
  const out: LanePill[] = [];
  for (const it of lane)
    if (it.state !== "planned" && it.state !== "done")
      out.push({ kind: "item", item: it, indent: false });
  for (const state of ["planned", "done"] as const) {
    const these = lane.filter((it) => it.state === state);
    if (these.length === 1 && these[0]) out.push({ kind: "item", item: these[0], indent: false });
    else if (these.length > 1) {
      const key = `${section}:${state}`;
      const isOpen = open.has(key);
      const ready = state === "planned" ? these.filter((it) => !it.waits) : [];
      const planned = state === "planned" ? these : [];
      out.push({ kind: "group", state, count: these.length, key, open: isOpen, ready, planned });
      if (isOpen) for (const it of these) out.push({ kind: "item", item: it, indent: true });
    }
  }
  return out;
}

/** A line of Markdown as plain words, for a box's second line. */
export const plainLine = (text: string) =>
  (text.split("\n").find((l) => l.trim() && !/^\s*(#|\||```)/.test(l)) ?? "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/[*_`[\]]/g, "")
    .trim();
/** A section's text as plain words, every line, for comparing two versions of it. */
export const plainText = (text: string) =>
  text
    .split("\n")
    .filter((l) => l.trim() && !/^\s*(\||```)/.test(l))
    .map((l) =>
      l
        .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
        .replace(/[*_`[\]]/g, "")
        .trim(),
    )
    .join(" ");
export const clip = (text: string, n: number) =>
  text.length > n ? `${text.slice(0, n - 1)}…` : text;
/** One key per section: its heading path, and which of its namesakes it is. */
export function keysOf(tree: SectionTree): string[] {
  const seen = new Map<string, number>();
  return tree.sections.map((s) => {
    const path = s.path.join("\u0000");
    const n = seen.get(path) ?? 0;
    seen.set(path, n + 1);
    return `${path}\u0001${String(n)}`;
  });
}

/** What the map is drawn from. */
export type MapInput = {
  tree: SectionTree;
  threads: readonly ThreadView[];
  previews: readonly PreviewView[];
  idOf: (index: number) => string;
  docs: readonly string[];
  docPath: string;
  /** Links to other docs are drawn (the links feature). */
  links: boolean;
  unfolded: ReadonlySet<string>;
  laneOpen: ReadonlySet<string>;
  writable: boolean;
  docText: () => string;
  /** The side each branch was on, so a Use never swaps the map round (30.35). */
  sidesKept: ReadonlyMap<string, -1 | 1>;
  moved: Readonly<Record<string, Pos>>;
  drag: { id: string; dx: number; dy: number } | null;
  /** Hears the sides as drawn now, for the next layout. */
  keepSides: (sides: Map<string, -1 | 1>) => void;
};

/** Every box on the map, laid out, with the person's moves applied. */
export function mapBoxes({
  tree,
  threads,
  previews,
  idOf,
  docs,
  docPath,
  links,
  unfolded,
  laneOpen,
  writable,
  docText,
  sidesKept,
  moved,
  drag,
  keepSides,
}: MapInput): Box[] {
  const nodes: MapNode[] = [];
  const info = new Map<string, Omit<Box, "x" | "y" | "w" | "h" | "side">>();
  for (const s of tree.sections) {
    const id = idOf(s.index);
    const heading = s.path.at(-1) ?? "";
    const here = threads.filter((t) => samePath(t.path, s.path));
    nodes.push({
      id,
      parent: s.parent === null ? null : idOf(s.parent),
      // Just its name (Mock 10): what hangs off it says what's happening there.
      ...sectionSize(heading, null, "", 0),
    });
    info.set(id, {
      id,
      kind: "section",
      index: s.index,
      heading,
      parent: s.parent === null ? null : idOf(s.parent),
    });
    // A branch hangs off the thread it came from (10.5), so each comes after its source.
    const onSection = new Set(here.map((t) => t.id));
    const depth = (t: ThreadView, seen = new Set<string>()): number => {
      const from = t.branchedFrom?.thread;
      if (!from || !onSection.has(from) || seen.has(t.id)) return 0;
      const source = here.find((x) => x.id === from);
      return source ? 1 + depth(source, new Set([...seen, t.id])) : 0;
    };
    // Work goes in a lane under its section (Mock 11): Build and Check threads,
    // and actions any thread here proposed and nobody has run.
    const lane: LaneItem[] = [];
    for (const t of threads)
      for (const it of t.items) {
        if (it.kind !== "proposed-action" || it.run) continue;
        const on = it.path ?? t.path;
        if (!on || !samePath(on, s.path)) continue;
        lane.push({
          key: `a:${it.id}`,
          state: "planned",
          title: it.title,
          thread: t,
          detail: it.what,
          ask: null,
          proposal: { thread: t.id, action: it.id },
          service: it.service ?? null,
          waits: actionWaits(threads, t, it.id),
        });
      }
    for (const t of [...here].sort((a, b) => depth(a) - depth(b))) {
      const tid = `t:${t.id}`;
      if (t.purpose && t.action) {
        lane.push({
          key: tid,
          state: t.action.state,
          title: t.title.replace(/^(Build|Check)( this section)?:?\s*/i, "") || t.title,
          thread: t,
          detail: t.action.detail,
          ask: t.action.ask,
        });
        continue;
      }
      const from = t.branchedFrom?.thread;
      // A thread exploring an option hangs off that option's box (fixed up below if it isn't drawn).
      const parent = t.explores
        ? `o:${t.explores.option}`
        : from && onSection.has(from)
          ? `t:${from}`
          : id;
      // A thread is a label on the line to its choices; one with none is counted on its section below.
      nodes.push({ id: tid, parent, w: labelWidth(t.title), h: 36 });
      info.set(tid, {
        id: tid,
        kind: "thread",
        index: s.index,
        thread: t,
        heading: t.title,
        parent,
      });
    }
    // Links to other docs' sections (8.6): one badge on the section, with the list on a click.
    const seen = new Set<string>();
    const outLinks: NonNullable<Box["outLinks"]> = [];
    for (const l of links ? s.linksOut : []) {
      if (l.sameDoc || l.embed) continue;
      const to = resolveWiki(docs, docPath, l.target, l.heading);
      const doc = to.kind === "doc" ? to.path : null;
      const key = `${doc ?? l.target}#${l.heading ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      outLinks.push({
        doc,
        heading: l.heading,
        label: doc
          ? [
              doc.replace(/\.md$/i, "").split("/").pop() ?? doc,
              ...(l.heading ? l.heading.split("#") : []),
            ].join(" › ")
          : `${l.target} (no such doc)`,
      });
    }
    const own = info.get(id);
    if (own && outLinks.length > 0) {
      own.outLinks = outLinks;
      // Room for the badge beside the name.
      const node = nodes.find((n) => n.id === id);
      if (node) Object.assign(node, sectionSize(heading, null, "", outLinks.length));
    }
    // The lane's rows add to the section's height, so the layout leaves room under it.
    {
      const pills = lanePills(lane, id, laneOpen);
      const own = info.get(id);
      if (own && pills.length) {
        own.lane = pills;
        own.laneH = pills.length * LANE_ROW + 6;
        // Its widest pill, so a lane opened by name doesn't run into the next box.
        const laneW = Math.max(
          ...pills.map((pl) =>
            pl.kind === "group"
              ? pl.ready.length > 0 && writable
                ? 190
                : 110
              : Math.min(280, Math.round(pl.item.title.length * 7 + 70)) + (pl.indent ? 16 : 0),
          ),
        );
        const node = nodes.find((n) => n.id === id);
        if (node) {
          node.h += own.laneH;
          if (laneW + 10 > node.w) {
            own.boxW = node.w;
            node.w = laneW + 10;
          }
        }
      }
    }
    // Each thread's option sets, one family per choice: a first set and the
    // narrower sets found exploring it. A choice still open shows its
    // options; a choice made folds the rest into a chip that opens again; a
    // set of parts shows those not yet added.
    for (const t of threads.filter((t) => samePath(t.path, s.path))) {
      const offers = t.items.flatMap((x) => (x.kind === "options" ? [x] : []));
      if (offers.length === 0) continue;
      type Offer = (typeof offers)[number];
      const familyOf = (x: Offer): Offer => {
        let at = x;
        for (let n = 0; at.within && n < 20; n++) {
          const up = offers.find((y) => y.options.some((o) => o.id === at.within));
          if (!up) break;
          at = up;
        }
        return at;
      };
      const firsts = offers.filter((x) => familyOf(x) === x);
      // A choice asked again replaces the earlier ask: by its heading, or the section's own.
      const keyOf = (x: Offer) => `${x.several ? "s" : "h"}:${(x.heading ?? "").toLowerCase()}`;
      const latest = new Map(firsts.map((f) => [keyOf(f), f] as const));
      const exploredIds = new Set(offers.flatMap((x) => x.explored));
      const optionBox = (
        o: Offer["options"][number],
        parentId: string,
        extra: { notPicked?: boolean; several?: boolean; skipped?: boolean } = {},
      ) => {
        const oid = `o:${o.id}`;
        // Working on it now: in this thread, or in the thread exploring it (30.32).
        const exploring =
          (t.busy && exploredIds.has(o.id) && !offers.some((x) => x.within === o.id)) ||
          threads.some((th) => th.busy && th.explores?.option === o.id);
        const sub = exploring ? "Exploring…" : clip(o.why ?? plainLine(o.text), 46);
        nodes.push({ id: oid, parent: parentId, ...boxSize(o.title, sub) });
        info.set(oid, {
          id: oid,
          kind: "option",
          index: s.index,
          thread: t,
          option: o,
          sub,
          exploring,
          explored: exploredIds.has(o.id),
          ...(extra.notPicked ? { notPicked: true } : {}),
          ...(extra.several ? { several: true } : {}),
          ...(extra.skipped ? { skipped: true } : {}),
          heading: o.title,
          parent: parentId,
        });
      };
      // Two or more choices in one thread: each hangs under its own name, so
      // "Who we target first" and "What we offer" don't read as one list.
      const named = firsts.filter((f) => !f.several && f.heading).length > 1;
      for (const f of firsts) {
        const family = offers.filter((x) => familyOf(x) === f);
        let tid = `t:${t.id}`;
        // A choice whose subsection is in the doc hangs off that box, under its name.
        const name = f.heading?.trim().toLowerCase();
        // A thread exploring an option keeps its choices under that option.
        const home =
          name && !f.several && !t.explores
            ? tree.sections.find(
                (x) =>
                  x.path.length > s.path.length &&
                  samePath(x.path.slice(0, s.path.length), s.path) &&
                  x.path.at(-1)?.trim().toLowerCase() === name,
              )
            : undefined;
        // An action's thread is a capsule in the lane, not a label: its
        // choices still need a line of their own, or they scatter round the section.
        const inLane = Boolean(t.purpose && t.action);
        if (home) {
          // Under its own section, which already names the decision: no label
          // between them, or the thread's title would repeat on every choice.
          tid = idOf(home.index);
        } else if ((f.heading && !f.several && named) || inLane) {
          const did = `d:${t.id}:${f.options[0]?.id ?? f.heading ?? t.id}`;
          const at = inLane ? id : tid;
          const label = f.heading ?? null;
          nodes.push({ id: did, parent: at, w: labelWidth(label ?? t.title), h: 36 });
          info.set(did, {
            id: did,
            kind: "thread",
            index: s.index,
            thread: t,
            ...(label ? { label } : {}),
            heading: f.heading ?? t.title,
            parent: at,
          });
          tid = did;
        }
        if (f.several) {
          // Parts asked again, as a rethink, replace the earlier parts with the same name.
          if (latest.get(keyOf(f)) !== f) continue;
          const skipped = f.options.filter(
            (o) => f.skipped.includes(o.id) && !f.added.includes(o.id),
          );
          for (const o of f.options)
            if (!f.added.includes(o.id) && !skipped.includes(o))
              optionBox(o, tid, { several: true });
          // Parts the person skipped: folded under one chip, still there to add.
          if (skipped.length > 0) {
            const fid = `k:${f.options[0]?.id ?? t.id}`;
            const label = `${String(skipped.length)} skipped`;
            const open = unfolded.has(fid);
            nodes.push({ id: fid, parent: tid, ...boxSize(label, "") });
            info.set(fid, {
              id: fid,
              kind: "option",
              index: s.index,
              thread: t,
              fold: { open, count: skipped.length },
              sub: open ? "Hide" : "Show",
              heading: label,
              parent: tid,
            });
            if (open) for (const o of skipped) optionBox(o, fid, { several: true, skipped: true });
          }
          continue;
        }
        // Picked here, or in a thread exploring one of these options.
        const familyIds = new Set(family.flatMap((x) => x.options.map((o) => o.id)));
        const picked =
          family.some((x) => x.used) ||
          threads.some(
            (th) =>
              th.explores &&
              familyIds.has(th.explores.option) &&
              th.items.some((x) => x.kind === "options" && x.used !== null),
          );
        if (picked) {
          // The rest, folded: a chip that opens to them, still to explore or switch to.
          const rest = family.flatMap((x) => x.options.filter((o) => o.id !== x.used));
          // The pick and any added beside it are in the doc; the rest fold.
          const usedIds = new Set(family.flatMap((x) => [...(x.used ? [x.used] : []), ...x.added]));
          const left = rest.filter((o) => !usedIds.has(o.id));
          if (left.length === 0) continue;
          const fid = `f:${f.options[0]?.id ?? t.id}`;
          const label = `${String(left.length)} not picked`;
          const open = unfolded.has(fid);
          nodes.push({ id: fid, parent: tid, ...boxSize(label, "") });
          info.set(fid, {
            id: fid,
            kind: "option",
            index: s.index,
            thread: t,
            fold: { open, count: left.length },
            sub: open ? "Hide" : "Show",
            heading: label,
            parent: tid,
          });
          if (open) for (const o of left) optionBox(o, fid, { notPicked: true });
          continue;
        }
        const current = latest.get(keyOf(f)) === f;
        const shownSets = family.filter((x) => x !== f || current);
        const shown = shownSets.flatMap((x) =>
          x === f
            ? x.options.map((o) => ({ o, under: null as string | null }))
            : x.within
              ? x.options.map((o) => ({ o, under: x.within ?? null }))
              : [],
        );
        // An earlier ask of the same choice: only what was explored stays.
        if (!current)
          shown.push(
            ...f.options.filter((o) => exploredIds.has(o.id)).map((o) => ({ o, under: null })),
          );
        const shownIds = new Set(shown.map((x) => x.o.id));
        for (const { o, under } of shown)
          optionBox(o, under && shownIds.has(under) ? `o:${under}` : tid);
      }
    }
    // An edit a thread proposed to this section: a dashed box until it's used or set aside.
    for (const p of previews) {
      const part = p.parts.find((x) => samePath(x.path, s.path));
      const t = threads.find((x) => x.id === p.thread);
      if (!part || !t) continue;
      const eid = `p:${p.thread}`;
      // The change itself ("£5 → £2.99"), not the section's opening words (17.2).
      const firstLine = changeSummary(
        plainText(withoutHeading(docText().slice(s.ownRange.from, s.ownRange.to))),
        plainText(withoutHeading(part.proposed)),
      );
      // Under its thread when the thread is on this section; else under the section it edits.
      const under = samePath(t.path, s.path) ? `t:${t.id}` : id;
      nodes.push({
        id: `${eid}:${id}`,
        parent: under,
        ...boxSize("Proposed edit   Use", firstLine),
      });
      info.set(`${eid}:${id}`, {
        id: `${eid}:${id}`,
        kind: "edit",
        index: s.index,
        thread: t,
        option: {
          id: eid,
          title: "Proposed edit",
          text: withoutHeading(part.proposed).trim(),
        },
        heading: "Proposed edit",
        sub: firstLine,
        parent: under,
      });
    }
  }
  // Threads before subsections, so they sit nearest their section.
  const near = (n: MapNode) =>
    Number(
      n.id.startsWith("t:") ||
        n.id.startsWith("d:") ||
        n.id.startsWith("o:") ||
        n.id.startsWith("p:") ||
        n.id.startsWith("l:"),
    );
  nodes.sort((a, b) => near(b) - near(a));
  // A box whose parent isn't drawn, such as a thread exploring an option now folded away,
  // hangs off its section instead.
  // A thread with nothing drawn off it isn't a box: it's counted on its section as 💬.
  const childOf = () => new Set(nodes.flatMap((n) => (n.parent ? [n.parent] : [])));
  // A choice's name with all its options added has nothing under it: it goes.
  const named = childOf();
  for (let k = nodes.length - 1; k >= 0; k--) {
    const n = nodes[k];
    if (!n?.id.startsWith("d:") || named.has(n.id)) continue;
    nodes.splice(k, 1);
    info.delete(n.id);
  }
  const hasChild = childOf();
  for (let k = nodes.length - 1; k >= 0; k--) {
    const n = nodes[k];
    if (!n?.id.startsWith("t:") || hasChild.has(n.id)) continue;
    const i = info.get(n.id);
    const sec = i ? info.get(idOf(i.index)) : undefined;
    if (i?.thread && sec) sec.chats = [...(sec.chats ?? []), i.thread];
    nodes.splice(k, 1);
    info.delete(n.id);
  }
  const drawn = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    if (n.parent === null || drawn.has(n.parent)) continue;
    const i = info.get(n.id);
    const section = i ? idOf(i.index) : null;
    n.parent = section && section !== n.id ? section : null;
    if (i) i.parent = n.parent;
  }
  const ordered = [
    nodes.find((n) => n.parent === null),
    ...nodes.filter((n) => n.parent !== null),
  ].filter((n): n is MapNode => Boolean(n));
  // Each box keeps the side it was given while the map is open; a new branch
  // takes the side its boxes were on, so a Use never swaps the map round (30.35).
  // A decision's name, on its label or the section a Use of it makes.
  const nameOf = (id: string) => {
    const i = info.get(id);
    if (i?.kind === "section" || id.startsWith("d:")) return i?.heading;
    // A thread's label carries the name of its one named set, if it has one.
    if (id.startsWith("t:") && i?.thread) {
      const sets = i.thread.items.filter((x) => x.kind === "options");
      const only = sets.length === 1 ? sets[0] : undefined;
      return only?.kind === "options" && only.heading ? only.heading : undefined;
    }
    return undefined;
  };
  const placed = mindLayout(ordered, keptSides(ordered, withNames(ordered, sidesKept, nameOf)));
  keepSides(sidesSeen(placed, nameOf));
  const out: Box[] = [];
  for (const [id, p] of placed) {
    const i = info.get(id);
    if (!i) continue;
    // A section with a lane: its box sits at the top of its slot, the lane below it.
    const lane = i.laneH ?? 0;
    // A lane wider than its box: the box keeps its width at the slot's inner edge.
    const own = i.boxW !== undefined && i.boxW < p.w ? i.boxW : p.w;
    const x =
      p.side === 1 ? p.x - p.w / 2 + own / 2 : p.side === -1 ? p.x + p.w / 2 - own / 2 : p.x;
    out.push({
      ...i,
      x,
      y: p.y - lane / 2,
      w: own,
      h: p.h - lane,
      side: p.side,
      ...(p.side === 0 && own < p.w ? { laneCentred: true } : {}),
    });
  }
  // A moved box sits where it was put; its threads move with it.
  const byId = new Map(out.map((b) => [b.id, b]));
  for (const b of out) {
    const own = sectionOf(b, byId)?.id ?? null;
    const anchor = own ? byId.get(own) : undefined;
    const put = own ? (drag?.id === own ? null : moved[own]) : undefined;
    const dragging = drag && own === drag.id ? drag : null;
    if (!anchor) continue;
    const dx = (put ? put.x - anchor.x : 0) + (dragging ? dragging.dx : 0);
    const dy = (put ? put.y - anchor.y : 0) + (dragging ? dragging.dy : 0);
    if (b.kind !== "section") {
      b.x += dx;
      b.y += dy;
      if (dx !== 0 || dy !== 0) b.shifted = true;
    }
  }
  // A choice, thread or edit dragged on its own (30.35) carries what hangs off it.
  const own = ownOffsets(out, moved, drag);
  for (const [id, d] of own) {
    const b = byId.get(id);
    if (!b) continue;
    b.x += d.dx;
    b.y += d.dy;
    b.shifted = true;
  }
  for (const b of out) {
    if (b.kind !== "section") continue;
    const put = moved[b.id];
    if (put) {
      if (put.x !== b.x || put.y !== b.y) b.shifted = true;
      b.x = put.x;
      b.y = put.y;
    }
    if (drag?.id === b.id) {
      b.x += drag.dx;
      b.y += drag.dy;
      b.shifted = true;
    }
  }
  return out;
}
