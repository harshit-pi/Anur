import { ServiceIcon, servicesUsed } from "../icons/services/index.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  boxSize,
  mapLayout,
  mindLayout,
  resolveWiki,
  type MapNode,
  type SectionTree,
} from "@anur/core";
import type { InkStroke, PreviewView, ThreadView } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
import { useFeatures } from "../features.ts";
import type { BoxStatus } from "../layout/box-status.ts";
import { changeSummary } from "../layout/change-summary.ts";
import { mapSkeleton } from "../layout/map-drawing.ts";
import { BoxSketch, sketchLine } from "./MapSketch.tsx";
import { useMapLayout } from "./map-layout-pref.ts";
import { useMapStyle } from "./map-style-pref.ts";
import "../editor/drawings/assets.ts";
import { Markdown, ThreadName, bodyOf } from "./Think.tsx";

/**
 * The map (task 7; Mock 3): the doc's sections as boxes, the title in the
 * middle, threads hanging off their sections. It is drawn from the
 * headings, so editing the page redraws it.
 *
 * As on a whiteboard (Excalidraw, draw.io): drag the background or scroll to
 * pan, pinch or ⌘-scroll to zoom, drag a box anywhere and it stays there,
 * double-click empty space to add a section there, or drag from a box's
 * handle: onto empty space for a new box under it, onto a box to link them. A click on a box shows
 * its section in Think. Arrow keys move between boxes; Shift+arrow nudges
 * the selected box. Moving a box never changes the file.
 */

type Pos = { x: number; y: number };
type View = { x: number; y: number; z: number };
type Box = {
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
  };
  /** The chip folding a made choice's other options, and whether it's open. */
  fold?: { open: boolean; count: number };
  /** The box's second line: what's under it, or what sets it apart. */
  sub?: string;
  /** What happened on a section's box, from its threads (mock 9). */
  status?: BoxStatus | null;
  /** A section's links to other docs (8.6), shown as one badge with a list. */
  outLinks?: { doc: string | null; heading: string | null; label: string }[];
  /** Where the layout put its parent's rail for its row, and the spine (group 7). */
  row?: number;
  rails?: number[];
  spine?: number;
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

/** The smallest zoom a map opens at, where a box's name still reads. */
const READABLE = 0.75;

/** A thread's pill: as wide as its name needs, within bounds. */
const pill = (title: string, marks = 0) => ({
  w: Math.max(150, Math.min(320, Math.round(title.length * 7.8 + 44 + marks * 18))),
  h: 36,
});
/**
 * A section box's size: room for its name beside the links badge, and for
 * the status chip beside the thread count on one line, so neither wraps a
 * word in two. The layout's height is an estimate; the box draws at its own.
 */
const sectionSize = (heading: string, status: BoxStatus | null, sub: string, links: number) => {
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

/** An action box's size (Mock 10): the same for every state. */
const ACTION_W = 236;
const ACTION_H = 58;

/** At most this many service marks on a thread's chip. */
const MARKS_SHOWN = 3;

/** A line of Markdown as plain words, for a box's second line. */
const plainLine = (text: string) =>
  (text.split("\n").find((l) => l.trim() && !/^\s*(#|\||```)/.test(l)) ?? "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/[*_`[\]]/g, "")
    .trim();
/** A section's text as plain words, every line, for comparing two versions of it. */
const plainText = (text: string) =>
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
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const samePath = (a: readonly string[] | null, b: readonly string[]) =>
  a !== null && a.length === b.length && a.every((x, i) => x === b[i]);

/** One key per section: its heading path, and which of its namesakes it is. */
function keysOf(tree: SectionTree): string[] {
  const seen = new Map<string, number>();
  return tree.sections.map((s) => {
    const path = s.path.join("\u0000");
    const n = seen.get(path) ?? 0;
    seen.set(path, n + 1);
    return `${path}\u0001${String(n)}`;
  });
}

export function MapView({
  docPath,
  tree,
  docText,
  selected,
  onSelect,
  onAddSection,
  onLink,
  onDelete,
  onRename,
  onUndo,
  onRedo,
  writable,
  docs,
}: {
  docPath: string;
  tree: SectionTree;
  docText: () => string;
  /** The section shown in Think, by index. */
  selected: number;
  onSelect: (index: number) => void;
  /** Add a section named `name` under the section at `parent`; returns its heading path. */
  onAddSection: (parent: number, name: string) => string[] | null;
  /** Link the section at `from` to the one at `to`, in `from`'s text. */
  onLink: (from: number, to: number) => void;
  /** Delete the section at `index` with everything under it; false when it can't be. */
  onDelete: (index: number) => boolean;
  /** Rename the section at `index`: its heading in the doc changes, so the page follows. */
  onRename: (index: number, name: string) => void;
  /** Undo and redo the page's last edit. */
  onUndo: () => void;
  onRedo: () => void;
  /** False when the doc can't be edited: boxes still move, but none can be added. */
  writable: boolean;
  /** The folder's docs, to place links to other docs (8.6). */
  docs: readonly string[];
}) {
  const features = useFeatures();
  const host = useRef<HTMLDivElement>(null);
  /** The section whose list of links is open (8.6). */
  const [openLinks, setOpenLinks] = useState<string | null>(null);
  /** The list opens upward from a box low in the view, so it stays on screen. */
  const [linksUp, setLinksUp] = useState(false);
  /** Section IDs by heading path, so a heading added above can't hand a box another's ID. */
  const [ids, setIds] = useState<Map<string, string>>(new Map());
  const [moved, setMoved] = useState<Record<string, Pos>>({});
  /** Folds of made choices the person opened, to see the options passed over. */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  /** Saved positions have arrived: only then is the first fit right. */
  const [loaded, setLoaded] = useState(false);
  /** Saved positions are late: frame the map without them, and move boxes when they come. */
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setWaited(true);
    }, 1200);
    return () => {
      window.clearTimeout(t);
    };
  }, []);
  const [threads, setThreads] = useState<ThreadView[]>([]);
  const [previews, setPreviews] = useState<PreviewView[]>([]);
  const previewed = useMemo(() => new Set(previews.map((p) => p.thread)), [previews]);
  const [view, setView] = useState<View | null>(null);
  /** The person panned or zoomed: the map stays where they put it. Until then it fits itself. */
  const userMoved = useRef(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  /** Naming a new box: where it goes, and its parent when it was drawn from a box. */
  const [makingDrawing, setMakingDrawing] = useState(false);
  /** Hand-drawn, as Excalidraw draws, when picked in Settings → Appearance. */
  const hand = useMapStyle() === "hand";
  const [layout, setLayout] = useMapLayout();
  /** A line as the map style draws it: one path, or its sketched strokes. */
  const line = (key: string, className: string, d: string, marker?: string) =>
    hand
      ? sketchLine(key, d, className.includes("thread")).map((sd, i, all) => (
          <path
            key={`${key}:${String(i)}`}
            className={className}
            d={sd}
            {...(marker && i === all.length - 1 ? { markerEnd: marker } : {})}
          />
        ))
      : [<path key={key} className={className} d={d} {...(marker ? { markerEnd: marker } : {})} />];
  /** The map as an Excalidraw drawing beside the doc, opened in a tab. */
  const openAsDrawing = async (newTab: boolean) => {
    const sameDocLinks = tree.sections.flatMap((s) =>
      [...new Set(s.linksOut.filter((l) => l.sameDoc).map((l) => l.targetIndex))]
        .filter((t): t is number => t !== null && t !== s.index)
        .map((t) => ({ from: idOf(s.index), to: idOf(t) })),
    );
    const skeleton = mapSkeleton(
      boxes.map((b) => ({
        id: b.id,
        // In a sketch an action draws as a section-like box, its state in its second line.
        kind: b.kind === "action" ? "section" : b.kind,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        heading: b.kind === "link" ? `→ ${b.heading}` : b.heading,
        sub: b.act ? `${b.act.tag} · ${ACTION_STATE[b.act.state]}` : b.sub,
        parent: b.parent,
      })),
      sameDocLinks,
    );
    // Excalidraw's own types don't resolve here: the calls used, typed.
    const ex = (await import("@excalidraw/excalidraw")) as unknown as {
      convertToExcalidrawElements: (s: unknown[], o: { regenerateIds: boolean }) => unknown[];
      serializeAsJSON: (e: unknown[], a: Record<string, unknown>, f: unknown, t: "local") => string;
      exportToSvg: (o: Record<string, unknown>) => Promise<SVGSVGElement>;
    };
    // Labels are sized as they're made: draw them once first, so Excalidraw has
    // its hand-drawn font loaded and measures with it, not a narrower stand-in.
    // The picture carries Excalifont as a data URL: in the page a moment, the
    // window has the font, and the labels below are measured with it.
    const probe = await ex.exportToSvg({
      elements: ex.convertToExcalidrawElements(skeleton, { regenerateIds: false }),
      appState: {},
      files: {},
    });
    probe.style.cssText = "position:absolute;left:-10000px;top:0;visibility:hidden";
    document.body.appendChild(probe);
    await document.fonts.load('18px "Excalifont"').catch(() => undefined);
    await document.fonts.ready;
    probe.remove();
    const elements = ex.convertToExcalidrawElements(skeleton, { regenerateIds: false });
    const scene = ex.serializeAsJSON(elements, { viewBackgroundColor: "#ffffff" }, {}, "local");
    const name = `${(docPath.split("/").pop() ?? docPath).replace(/\.md$/i, "")} - Map`;
    const r = await anur.call("drawing:create", { near: docPath, name, scene });
    if (r.kind === "created")
      window.dispatchEvent(new CustomEvent("anur:open-path", { detail: { path: r.path, newTab } }));
  };
  /** The section being renamed in its box, by index. */
  const [renaming, setRenaming] = useState<number | null>(null);
  const [adding, setAdding] = useState<{ at: Pos; screen: Pos; parent?: number } | null>(null);
  /** An arrow being drawn from a box's handle. */
  const [linking, setLinking] = useState<{ from: string; to: Pos; over: number | null } | null>(
    null,
  );
  /**
   * The map's own undo: box moves, which never touch the file, and markers
   * for its edits to the file, which the page's history undoes.
   */
  type Step =
    | { kind: "moves"; before: Record<string, Pos | null>; after: Record<string, Pos | null> }
    | { kind: "doc" };
  const done = useRef<Step[]>([]);
  const undone = useRef<Step[]>([]);
  const record = (step: Step) => {
    done.current.push(step);
    undone.current = [];
  };
  /** The box under the pointer, after a moment: its section's text shows beside it. */
  /** What the pointer rests on: a section, "s:<index>", or an option, "o:<id>". */
  const [peek, setPeek] = useState<string | null>(null);
  const peekTimer = useRef(0);
  const peekWant = useRef<string | null>(null);
  const peekClose = useRef(0);
  /** Pointer on a box opens its text after a moment; the text stays while the pointer is on it. */
  const onHover = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".map-peek")) {
      window.clearTimeout(peekClose.current);
      return;
    }
    const i = target.closest<HTMLElement>("[data-peek]")?.dataset.peek ?? null;
    if (i === null) {
      // A moment to cross the gap from the box to its text.
      peekWant.current = null;
      window.clearTimeout(peekTimer.current);
      window.clearTimeout(peekClose.current);
      peekClose.current = window.setTimeout(() => {
        setPeek(null);
      }, 300);
      return;
    }
    window.clearTimeout(peekClose.current);
    if (i === peekWant.current) return;
    peekWant.current = i;
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => {
      setPeek(i);
    }, 450);
  };
  const placeNew = useRef<{ path: string[]; at: Pos } | null>(null);
  /** The side each box under the title sits on in the mind map, so adding one moves no other. */
  const sidesKept = useRef(new Map<string, -1 | 1>());
  /** Fit was pressed: the next framing shows the whole map, however small. */
  const fitAll = useRef(false);
  /** A section just made by Tab or Enter: named next, and removed if left untouched (mock 8). */
  const freshNew = useRef<{ path: string[]; armed: boolean } | null>(null);
  const [freshIndex, setFreshIndex] = useState<number | null>(null);
  /** Set by Escape so the blur that follows doesn't save the name. */
  const cancelRename = useRef(false);
  /** A short note on the map: what a key just did to the doc, or why it didn't. */
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => {
      setNote(null);
    }, 3200);
    return () => {
      window.clearTimeout(t);
    };
  }, [note]);
  const textNow = useRef(docText);
  textNow.current = docText;

  /** Pen strokes on this map (every device's), and what the pen is doing. */
  const [ink, setInk] = useState<InkStroke[]>([]);
  const [pen, setPen] = useState<"off" | "draw" | "erase">("off");
  const [inkNow, setInkNow] = useState<[number, number][] | null>(null);
  useEffect(() => {
    let current = true;
    setInk([]);
    void anur.call("map:ink", { path: docPath, text: textNow.current() }).then((r) => {
      if (current) setInk(r.strokes);
    });
    return () => {
      current = false;
    };
  }, [docPath]);

  // Section IDs and saved positions, read again when the headings change.
  const headings = tree.sections.map((s) => s.path.join("\u0000")).join("\u0001");
  useEffect(() => {
    let current = true;
    const keys = keysOf(tree);
    void anur.call("map:read", { path: docPath, text: textNow.current() }).then((r) => {
      if (!current) return;
      setIds(new Map(r.ids.map((id, i) => [keys[i] ?? id, id])));
      setMoved(r.positions);
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [docPath, headings]);

  // Threads hang off their sections; a dot marks one with a preview waiting.
  useEffect(() => {
    let current = true;
    const load = () => {
      const text = textNow.current();
      void anur.call("thread:list", { path: docPath, text }).then((r) => {
        if (current) setThreads(r.threads.filter((t) => !t.closed));
      });
      void anur.call("preview:list", { path: docPath, text }).then((r) => {
        if (current) setPreviews(r.previews);
      });
    };
    load();
    const off = anur.on("thread:event", (e) => {
      if (e.kind === "thread" && e.path === docPath) load();
    });
    const offPreviews = anur.on("preview:changed", ({ path }) => {
      if (path === docPath) load();
    });
    return () => {
      current = false;
      off();
      offPreviews();
    };
  }, [docPath, headings]);

  const keys = useMemo(() => keysOf(tree), [tree]);
  const idOf = useCallback(
    (index: number) => {
      const key = keys[index] ?? String(index);
      return ids.get(key) ?? `new:${key}`;
    },
    [ids, keys],
  );

  // The layout: sections, with each section's threads as its nearest children.
  const boxes = useMemo(() => {
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
      // Actions a thread proposed and nobody has run hang off that thread, planned, with ▶ Run.
      const planned = (t: ThreadView, tid: string) => {
        for (const it of t.items) {
          if (it.kind !== "proposed-action" || it.run) continue;
          const aid = `a:${it.id}`;
          nodes.push({ id: aid, parent: tid, w: ACTION_W, h: ACTION_H });
          info.set(aid, {
            id: aid,
            kind: "action",
            index: s.index,
            thread: t,
            heading: it.title,
            act: {
              state: "planned",
              tag: "BUILD",
              detail: "Proposed",
              ask: null,
              proposal: { thread: t.id, action: it.id },
              what: it.what,
            },
            parent: tid,
          });
        }
      };
      for (const t of [...here].sort((a, b) => depth(a) - depth(b))) {
        const tid = `t:${t.id}`;
        const from = t.branchedFrom?.thread;
        const parent = from && onSection.has(from) ? `t:${from}` : id;
        // A Build or Check is an action box; any other thread, a chip.
        if (t.purpose && t.action) {
          nodes.push({ id: tid, parent, w: ACTION_W, h: ACTION_H });
          info.set(tid, {
            id: tid,
            kind: "action",
            index: s.index,
            thread: t,
            heading: t.title.replace(/^(Build|Check)( this section)?:?\s*/i, "") || t.title,
            act: {
              state: t.action.state,
              tag: t.purpose === "check" ? "CHECK" : "BUILD",
              detail: t.action.detail,
              ask: t.action.ask,
            },
            parent,
          });
          planned(t, tid);
          continue;
        }
        nodes.push({
          id: tid,
          parent,
          ...pill(t.title, Math.min(MARKS_SHOWN, servicesUsed(t.items).length)),
        });
        info.set(tid, {
          id: tid,
          kind: "thread",
          index: s.index,
          thread: t,
          heading: t.title,
          parent,
        });
        planned(t, tid);
      }
      // Links to other docs' sections (8.6): one badge on the section, with the list on a click.
      const seen = new Set<string>();
      const outLinks: NonNullable<Box["outLinks"]> = [];
      for (const l of features.links ? s.linksOut : []) {
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
        const keyOf = (x: Offer) =>
          x.several ? `s:${x.options[0]?.id ?? ""}` : `h:${(x.heading ?? "").toLowerCase()}`;
        const latest = new Map(firsts.map((f) => [keyOf(f), f] as const));
        const exploredIds = new Set(offers.flatMap((x) => x.explored));
        const optionBox = (
          o: Offer["options"][number],
          parentId: string,
          extra: { notPicked?: boolean } = {},
        ) => {
          const oid = `o:${o.id}`;
          const exploring =
            t.busy && exploredIds.has(o.id) && !offers.some((x) => x.within === o.id);
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
            heading: o.title,
            parent: parentId,
          });
        };
        for (const f of firsts) {
          const family = offers.filter((x) => familyOf(x) === f);
          const tid = `t:${t.id}`;
          if (f.several) {
            for (const o of f.options) if (!f.added.includes(o.id)) optionBox(o, tid);
            continue;
          }
          const picked = family.some((x) => x.used);
          if (picked) {
            // The rest, folded: a chip that opens to them, still to explore or switch to.
            const rest = family.flatMap((x) => x.options.filter((o) => o.id !== x.used));
            const usedIds = new Set(family.flatMap((x) => (x.used ? [x.used] : [])));
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
        const body = (t: string) => t.replace(/^#{1,6}[ \t].*\n?/, "");
        // The change itself ("£5 → £2.99"), not the section's opening words (17.2).
        const firstLine = changeSummary(
          plainText(body(docText().slice(s.ownRange.from, s.ownRange.to))),
          plainText(body(part.proposed)),
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
            text: part.proposed.replace(/^#{1,6}[ \t].*\n?/, "").trim(),
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
          n.id.startsWith("o:") ||
          n.id.startsWith("p:") ||
          n.id.startsWith("l:"),
      );
    nodes.sort((a, b) => near(b) - near(a));
    const ordered = [
      nodes.find((n) => n.parent === null),
      ...nodes.filter((n) => n.parent !== null),
    ].filter((n): n is MapNode => Boolean(n));
    const placed = layout === "mind" ? mindLayout(ordered, sidesKept.current) : mapLayout(ordered);
    // Each box under the title keeps the side it was given while the map is open.
    if (layout === "mind") {
      const root = ordered[0]?.id;
      sidesKept.current = new Map(
        ordered.flatMap((n) => {
          const side = placed.get(n.id)?.side;
          return n.parent === root && (side === 1 || side === -1) ? [[n.id, side] as const] : [];
        }),
      );
    }
    const out: Box[] = [];
    for (const [id, p] of placed) {
      const i = info.get(id);
      if (!i) continue;
      out.push({
        ...i,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        side: p.side,
        ...(p.row !== undefined ? { row: p.row } : {}),
        ...(p.rails ? { rails: p.rails } : {}),
        ...(p.spine !== undefined ? { spine: p.spine } : {}),
      });
    }
    // A moved box sits where it was put; its threads move with it.
    const byId = new Map(out.map((b) => [b.id, b]));
    // The section a box hangs from: threads, their options and edits move with it.
    const sectionOf = (b: Box): string | null => {
      let at: Box | undefined = b;
      while (at && at.kind !== "section") at = at.parent ? byId.get(at.parent) : undefined;
      return at?.id ?? null;
    };
    for (const b of out) {
      const own = sectionOf(b);
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
  }, [tree, threads, previews, idOf, moved, drag, docs, docPath, features.links, layout, unfolded]);

  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);

  // A section made by a key opens for its name once it's in the tree.
  useEffect(() => {
    const want = freshNew.current;
    if (!want?.armed) return;
    const at = tree.sections.find((x) => samePath(x.path, want.path));
    if (!at) return;
    want.armed = false;
    onSelect(at.index);
    setFreshIndex(at.index);
    setRenaming(at.index);
  }, [tree, onSelect]);

  // A section added by double-click is put where it was drawn, once it has an ID.
  useEffect(() => {
    const want = placeNew.current;
    if (!want) return;
    const s = tree.sections.find((x) => samePath(x.path, want.path));
    const id = s ? ids.get(keys[s.index] ?? "") : undefined;
    if (!s || !id) return;
    placeNew.current = null;
    setMoved((m) => ({ ...m, [id]: want.at }));
    void anur.call("map:save", {
      path: docPath,
      text: textNow.current(),
      positions: { [id]: want.at },
    });
    onSelect(s.index);
  }, [tree, ids, keys, docPath, onSelect]);

  // Start with the title in the middle, everything in view.
  useEffect(() => {
    const el = host.current;
    if (!el || view || (!loaded && !waited) || boxes.length === 0) return;
    const r = el.getBoundingClientRect();
    const xs = boxes.flatMap((b) => [b.x - b.w / 2, b.x + b.w / 2]);
    const ys = boxes.flatMap((b) => [b.y - b.h / 2, b.y + b.h / 2]);
    const w = Math.max(...xs) - Math.min(...xs) + 120;
    const h = Math.max(...ys) - Math.min(...ys) + 120;
    const all = Math.min(1, r.width / w, r.height / h);
    // Never so small the names can't be read: a wide map opens on its title,
    // at the top, and Fit shows the whole of it.
    // Fit pressed shows all of it; opening, never so small the names can't be read.
    const z = fitAll.current ? all : Math.max(READABLE, all);
    fitAll.current = false;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const title = boxes.find((b) => b.side === 0);
    // In the mind map the title is in the middle, so the view centres on it.
    if (z > all && title && layout === "mind")
      setView({ x: r.width / 2 - title.x * z, y: r.height / 2 - title.y * z, z });
    else if (z > all && title)
      setView({ x: r.width / 2 - title.x * z, y: 60 - Math.min(...ys) * z, z });
    else setView({ x: r.width / 2 - cx * z, y: r.height / 2 - cy * z, z });
  }, [boxes, view, loaded, waited, layout]);

  // New boxes, such as a thread's options, come into view: the map fits
  // itself again, unless the person has panned or zoomed it.
  const count = boxes.length;
  const lastCount = useRef(count);
  const lastIds = useRef(new Set(boxes.map((b) => b.id)));
  useEffect(() => {
    const fresh = boxes.filter((b) => !lastIds.current.has(b.id));
    lastIds.current = new Set(boxes.map((b) => b.id));
    // Only a map already framed is framed again: while the first fit is
    // pending, clearing the view here would undo it in the same commit.
    if (count > lastCount.current && view !== null) {
      const el = host.current;
      const r = el?.getBoundingClientRect();
      // After a pan the map holds still, unless every new box landed out of
      // sight, as a whole new outline does: then it fits again.
      const unseen =
        !!r &&
        fresh.length > 0 &&
        fresh.every((b) => {
          const left = (b.x + b.w / 2) * view.z + view.x;
          const right = (b.x - b.w / 2) * view.z + view.x;
          const top = (b.y + b.h / 2) * view.z + view.y;
          const bottom = (b.y - b.h / 2) * view.z + view.y;
          return left < 0 || right > r.width || top < 0 || bottom > r.height;
        });
      if (unseen) {
        // Bring the new boxes into view where they are, as one group, keeping
        // the zoom unless they need less of it: refitting on the title would
        // leave a mind map's far branches out of sight.
        const xs = fresh.flatMap((b) => [b.x - b.w / 2, b.x + b.w / 2]);
        const ys = fresh.flatMap((b) => [b.y - b.h / 2, b.y + b.h / 2]);
        const w = Math.max(...xs) - Math.min(...xs) + 120;
        const h = Math.max(...ys) - Math.min(...ys) + 120;
        const z = Math.min(view.z, r.width / w, r.height / h);
        const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
        const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
        setView({ x: r.width / 2 - cx * z, y: r.height / 2 - cy * z, z });
      } else if (!userMoved.current) setView(null);
    }
    lastCount.current = count;
  }, [count]);

  // The selected box stays in view: arrow keys and new sections pan to it.
  const selectedId = idOf(selected);
  useEffect(() => {
    const el = host.current;
    const b = boxes.find((x) => x.id === selectedId);
    if (!el || !b || drag) return;
    const r = el.getBoundingClientRect();
    setView((v) => {
      if (!v) return v;
      const pad = 40;
      const left = (b.x - b.w / 2) * v.z + v.x;
      const right = (b.x + b.w / 2) * v.z + v.x;
      const top = (b.y - b.h / 2) * v.z + v.y;
      const bottom = (b.y + b.h / 2) * v.z + v.y;
      const dx = left < pad ? pad - left : right > r.width - pad ? r.width - pad - right : 0;
      const dy = top < pad ? pad - top : bottom > r.height - 60 ? r.height - 60 - bottom : 0;
      return dx === 0 && dy === 0 ? v : { ...v, x: v.x + dx, y: v.y + dy };
    });
    // Only when the selection or the boxes change, not on every pan.
  }, [selectedId, boxes]);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Pos => {
      const r = host.current?.getBoundingClientRect();
      const v = view ?? { x: 0, y: 0, z: 1 };
      return {
        x: (clientX - (r?.left ?? 0) - v.x) / v.z,
        y: (clientY - (r?.top ?? 0) - v.y) / v.z,
      };
    },
    [view],
  );

  /** A stroke's points on the map now: with its box, wherever that box has moved. */
  const inkPoints = (st: InkStroke): [number, number][] | null => {
    const at = st.anchor ? byId.get(st.anchor) : undefined;
    if (st.anchor && !at) return null;
    const ox = at?.x ?? 0;
    const oy = at?.y ?? 0;
    return st.pts.map(([x, y]) => [x + ox, y + oy]);
  };
  const inkPath = (pts: [number, number][]) =>
    pts.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  /** A stroke drawn on the map: anchored to the box nearest its middle, then kept. */
  const onPenDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || pen !== "draw") return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone.
    }
    const z = view?.z ?? 1;
    const first = toWorld(e.clientX, e.clientY);
    const pts: [number, number][] = [[first.x, first.y]];
    setInkNow([...pts]);
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const last = pts[pts.length - 1];
      if (last && Math.hypot(p.x - last[0], p.y - last[1]) < 1.5 / z) return;
      pts.push([p.x, p.y]);
      setInkNow([...pts]);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setInkNow(null);
      if (pts.length < 2) return;
      const cx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
      const cy = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
      let near: Box | null = null;
      let best = Infinity;
      for (const b of byId.values()) {
        if (b.kind !== "section" && b.kind !== "thread") continue;
        const d = Math.hypot(b.x - cx, b.y - cy);
        if (d < best) {
          best = d;
          near = b;
        }
      }
      const stroke: InkStroke = {
        id: `k${Math.random().toString(36).slice(2, 12)}`,
        anchor: near?.id ?? null,
        pts: pts.map(([x, y]) => [x - (near?.x ?? 0), y - (near?.y ?? 0)]),
        color: "red",
      };
      setInk((all) => [...all, stroke]);
      void anur.call("map:ink-change", {
        path: docPath,
        text: textNow.current(),
        add: [stroke],
        erase: [],
      });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const eraseInk = (id: string) => {
    setInk((all) => all.filter((s) => s.id !== id));
    void anur.call("map:ink-change", {
      path: docPath,
      text: textNow.current(),
      add: [],
      erase: [id],
    });
  };

  const save = useCallback(
    (positions: Record<string, Pos | null>) => {
      void anur.call("map:save", { path: docPath, text: textNow.current(), positions });
    },
    [docPath],
  );

  /** Put boxes at `positions` (null: back in the layout), as one step to undo. */
  const place = (positions: Record<string, Pos | null>) => {
    setMoved((m) => {
      const next = { ...m };
      for (const [id, p] of Object.entries(positions)) {
        if (p) next[id] = p;
        else Reflect.deleteProperty(next, id);
      }
      return next;
    });
    save(positions);
  };
  const moveBoxes = (positions: Record<string, Pos | null>) => {
    const before = Object.fromEntries(Object.keys(positions).map((id) => [id, moved[id] ?? null]));
    record({ kind: "moves", before, after: positions });
    place(positions);
  };
  const undo = () => {
    const step = done.current.pop();
    if (!step) {
      onUndo();
      return;
    }
    undone.current.push(step);
    if (step.kind === "moves") place(step.before);
    else onUndo();
  };
  const redo = () => {
    const step = undone.current.pop();
    if (!step) {
      onRedo();
      return;
    }
    done.current.push(step);
    if (step.kind === "moves") place(step.after);
    else onRedo();
  };

  // Background: drag to pan.
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget || !view) return;
    host.current?.focus();
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone.
    }
    const move = (ev: PointerEvent) => {
      userMoved.current = true;
      setView((v) =>
        v ? { ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y } : v,
      );
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  // Scroll pans; pinch or ⌘-scroll zooms around the pointer.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      // The section's text under the pointer scrolls itself.
      if (!(e.ctrlKey || e.metaKey) && (e.target as HTMLElement).closest(".map-peek")) return;
      e.preventDefault();
      userMoved.current = true;
      setView((v) => {
        if (!v) return v;
        if (e.ctrlKey || e.metaKey) {
          const r = el.getBoundingClientRect();
          const px = e.clientX - r.left;
          const py = e.clientY - r.top;
          const z = Math.min(2.5, Math.max(0.2, v.z * Math.exp(-e.deltaY * 0.01)));
          return { x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z, z };
        }
        return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  // A box: click selects it, drag moves it anywhere.
  const onBoxDown = (e: React.PointerEvent, b: Box) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    host.current?.focus();
    if (b.kind === "link") {
      if (b.link?.doc)
        window.dispatchEvent(
          new CustomEvent("anur:open-path", {
            detail: { path: b.link.doc, heading: b.link.heading },
          }),
        );
      return;
    }
    if (
      (b.kind === "thread" || b.kind === "option" || b.kind === "edit" || b.kind === "action") &&
      b.thread
    ) {
      onSelect(b.index);
      window.dispatchEvent(
        new CustomEvent("anur:open-thread", { detail: { thread: b.thread.id } }),
      );
      // An option: its card in the thread, once the thread has drawn.
      const option = b.kind === "option" ? b.option?.id : undefined;
      if (option)
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("anur:show-option", { detail: { option } }));
        }, 250);
      return;
    }
    onSelect(b.index);
    const z = view?.z ?? 1;
    const start = { x: e.clientX, y: e.clientY };
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone.
    }
    let moving = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / z;
      const dy = (ev.clientY - start.y) / z;
      if (!moving && Math.hypot(dx, dy) < 3) return;
      moving = true;
      setDrag({ id: b.id, dx, dy });
    };
    // On the window, as for a handle: a box drawn again mid-drag still hears the let-go.
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (!moving) return;
      const at = { x: b.x + (ev.clientX - start.x) / z, y: b.y + (ev.clientY - start.y) / z };
      moveBoxes({ [b.id]: at });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // A box's handle: drag out an arrow. Dropped on a box, it links the two
  // sections; dropped on empty space, it makes a new box under this one.
  const onHandleDown = (e: React.PointerEvent, b: Box) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(b.index);
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone.
    }
    const target = (ev: PointerEvent) => {
      const hit = document
        .elementsFromPoint(ev.clientX, ev.clientY)
        .map((x) => x.closest<HTMLElement>("[data-section]"))
        .find(Boolean);
      const i = hit ? Number(hit.dataset.section) : NaN;
      return Number.isNaN(i) || i === b.index ? null : i;
    };
    const move = (ev: PointerEvent) => {
      setLinking({ from: b.id, to: toWorld(ev.clientX, ev.clientY), over: target(ev) });
    };
    // On the window, not the handle: if the box is drawn again mid-drag (its
    // section's ID settling after a save), a let-go is still heard.
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setLinking(null);
    };
    const cancel = () => {
      stop();
    };
    const up = (ev: PointerEvent) => {
      stop();
      const over = target(ev);
      if (over !== null) {
        onLink(b.index, over);
        record({ kind: "doc" });
        return;
      }
      const at = toWorld(ev.clientX, ev.clientY);
      if (Math.hypot(at.x - b.x, at.y - b.y) < Math.max(b.w, b.h) / 2 + 12) return;
      const r = host.current?.getBoundingClientRect();
      setAdding({
        at,
        screen: { x: ev.clientX - (r?.left ?? 0), y: ev.clientY - (r?.top ?? 0) },
        parent: b.index,
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // Arrow keys move between boxes; Shift+arrow nudges the selected one.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && pen !== "off") {
      e.preventDefault();
      setPen("off");
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    // Tab: a section under the selected one; Enter: one beside it (mock 8).
    // Each writes its heading into the doc, then opens for its name.
    if ((e.key === "Tab" || e.key === "Enter") && !e.shiftKey && !mod && writable) {
      const here = tree.sections[selected];
      if (!here) return;
      e.preventDefault();
      const parent = e.key === "Enter" && here.parent !== null ? here.parent : selected;
      if (e.key === "Tab" && here.level >= 6) {
        setNote("Markdown headings stop at six levels, so this one can't have sections under it");
        return;
      }
      const under = tree.sections[parent];
      const taken = new Set(
        tree.sections.filter((x) => x.parent === parent).map((x) => x.path.at(-1) ?? ""),
      );
      let name = "New section";
      for (let n = 2; taken.has(name); n++) name = `New section ${String(n)}`;
      const path = onAddSection(parent, name);
      if (path) {
        record({ kind: "doc" });
        freshNew.current = { path, armed: true };
        setNote(`Added a heading under ${under?.path.at(-1) ?? "the title"} in the doc`);
      }
      return;
    }
    if (e.key === "F2" && writable && tree.sections[selected]) {
      e.preventDefault();
      setRenaming(selected);
      return;
    }
    // Backspace or Delete: only an empty section goes from the map; one with
    // text or sections under it is removed on the page, where its words show.
    if ((e.key === "Backspace" || e.key === "Delete") && writable) {
      e.preventDefault();
      const s = tree.sections[selected];
      if (!s || selected === 0) return;
      const empty =
        !tree.sections.some((x) => x.parent === selected) && !bodyOf(docText(), s).trim();
      if (!empty) {
        setNote(
          `${s.path.at(-1) ?? "This section"} has text or sections under it: remove it on the page`,
        );
        return;
      }
      const parent = s.parent ?? 0;
      if (onDelete(selected)) {
        record({ kind: "doc" });
        onSelect(parent);
      }
      return;
    }
    const dirs: Record<string, readonly [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowDown: [0, 1],
      ArrowUp: [0, -1],
    };
    const dir = dirs[e.key];
    if (!dir) return;
    const [ux, uy] = dir;
    e.preventDefault();
    const now = byId.get(idOf(selected));
    if (!now) return;
    if (e.shiftKey) {
      moveBoxes({ [now.id]: { x: now.x + ux * 16, y: now.y + uy * 16 } });
      return;
    }
    let best: Box | null = null;
    let bestScore = Infinity;
    for (const b of boxes) {
      if (b.kind !== "section" || b.id === now.id) continue;
      const dx = b.x - now.x;
      const dy = b.y - now.y;
      const along = dx * ux + dy * uy;
      if (along <= 0) continue;
      const across = Math.abs(dx * uy - dy * ux);
      if (across > along * 1.5) continue;
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best) onSelect(best.index);
  };

  // Double-click empty space: name a new section, under the nearest box.
  const onDoubleClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget || !writable) return;
    const r = host.current?.getBoundingClientRect();
    setAdding({
      at: toWorld(e.clientX, e.clientY),
      screen: { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) },
    });
  };
  const add = (name: string) => {
    const at = adding?.at;
    const drawnFrom = adding?.parent;
    setAdding(null);
    if (!at || !name.trim()) return;
    let parent = drawnFrom ?? 0;
    let best = Infinity;
    for (const b of boxes) {
      if (drawnFrom !== undefined || b.kind !== "section") continue;
      const d = Math.hypot(b.x - at.x, b.y - at.y);
      if (d < best) {
        best = d;
        parent = b.index;
      }
    }
    const path = onAddSection(parent, name.trim());
    if (path) {
      record({ kind: "doc" });
      placeNew.current = { path, at };
    } else if ((tree.sections[parent]?.level ?? 0) >= 6)
      setNote("Markdown headings stop at six levels, so that box can't have sections under it");
  };

  const v = view ?? { x: 0, y: 0, z: 1 };
  const edges = boxes.flatMap((b) => {
    const p = b.parent ? byId.get(b.parent) : undefined;
    if (!p) return [];
    // Laid out as placed: a trunk from the parent, its row's rail, and a drop to the box.
    const r = b.row ?? 0;
    const rail = p.rails?.[r];
    const first = p.rails?.[0];
    if (!b.shifted && !p.shifted && rail !== undefined && first !== undefined) {
      const top = b.y - b.h / 2;
      const pts =
        r === 0
          ? [
              [p.x, p.y + p.h / 2],
              [p.x, rail],
              [b.x, rail],
              [b.x, top],
            ]
          : [
              [p.x, p.y + p.h / 2],
              [p.x, first],
              [p.spine ?? p.x, first],
              [p.spine ?? p.x, rail],
              [b.x, rail],
              [b.x, top],
            ];
      return line(
        b.id,
        b.kind === "section" ? "map-edge rail" : "map-edge rail thread",
        pts.map(([x, y], k) => `${k ? "L" : "M"} ${String(x)} ${String(y)}`).join(" "),
      );
    }
    // From the parent's bottom to the child's top, a soft S; sideways when a
    // moved box sits beside, and always in the mind map, which branches sideways.
    const beside = layout === "mind" && Math.abs(b.x - p.x) > (b.w + p.w) / 2;
    const below = !beside && b.y - b.h / 2 >= p.y + p.h / 2;
    const above = !beside && b.y + b.h / 2 <= p.y - p.h / 2;
    let d: string;
    if (below || above) {
      const dir = below ? 1 : -1;
      const y1 = p.y + (dir * p.h) / 2;
      const y2 = b.y - (dir * b.h) / 2;
      const mid = (y1 + y2) / 2;
      d = `M ${String(p.x)} ${String(y1)} C ${String(p.x)} ${String(mid)}, ${String(b.x)} ${String(mid)}, ${String(b.x)} ${String(y2)}`;
    } else {
      const side = b.x >= p.x ? 1 : -1;
      const x1 = p.x + (side * p.w) / 2;
      const x2 = b.x - (side * b.w) / 2;
      const mid = (x1 + x2) / 2;
      d = `M ${String(x1)} ${String(p.y)} C ${String(mid)} ${String(p.y)}, ${String(mid)} ${String(b.y)}, ${String(x2)} ${String(b.y)}`;
    }
    return [...line(b.id, b.kind === "section" ? "map-edge" : "map-edge thread", d)];
  });

  // Links between sections, drawn as arrows from the linking box to its target.
  const edge = (a: { x: number; y: number; w: number; h: number }, to: Pos) => {
    const dx = to.x - a.x;
    const dy = to.y - a.y;
    // Leave from the side facing the target.
    const t = Math.min(
      Math.abs(dx) > 0 ? a.w / 2 / Math.abs(dx) : Infinity,
      Math.abs(dy) > 0 ? a.h / 2 / Math.abs(dy) : Infinity,
    );
    return { x: a.x + dx * Math.min(1, t), y: a.y + dy * Math.min(1, t) };
  };
  const inText = tree.sections.flatMap((s) =>
    [...new Set(s.linksOut.filter((l) => l.sameDoc).map((l) => l.targetIndex))]
      .filter((t): t is number => t !== null && t !== s.index)
      .map((t) => ({ s, t })),
  );
  const links = inText.flatMap(({ s, t }) => {
    const a = byId.get(idOf(s.index));
    const b = byId.get(idOf(t));
    if (!a || !b) return [];
    const p = edge(a, b);
    const q = edge(b, a);
    // The words the link reads as in the text, when they aren't just the heading.
    const heading = tree.sections[t]?.path.at(-1) ?? "";
    const label = s.linksOut.find(
      (l) => l.sameDoc && l.targetIndex === t && l.alias && l.alias !== heading,
    )?.alias;
    return [
      ...line(
        `${a.id}>${b.id}`,
        "map-link",
        `M ${String(p.x)} ${String(p.y)} L ${String(q.x)} ${String(q.y)}`,
        "url(#map-arrow)",
      ),
      ...(label
        ? [
            <text
              key={`${a.id}>${b.id}:label`}
              className="map-link-label"
              x={(p.x + q.x) / 2}
              y={(p.y + q.y) / 2 - 6}
              textAnchor="middle"
            >
              {label.length > 32 ? `${label.slice(0, 31)}…` : label}
            </text>,
          ]
        : []),
    ];
  });
  const drawing = (() => {
    if (!linking) return null;
    const a = byId.get(linking.from);
    if (!a) return null;
    const p = edge(a, linking.to);
    return (
      <line
        className="map-link drawing"
        x1={p.x}
        y1={p.y}
        x2={linking.to.x}
        y2={linking.to.y}
        markerEnd="url(#map-arrow)"
      />
    );
  })();

  return (
    <div
      ref={host}
      className="map"
      data-style={hand ? "hand" : "clean"}
      tabIndex={0}
      role="application"
      aria-label="Map of the doc's sections"
      onPointerDown={onBackgroundDown}
      onDoubleClick={onDoubleClick}
      onPointerOver={onHover}
      onPointerLeave={() => {
        peekWant.current = null;
        window.clearTimeout(peekTimer.current);
        setPeek(null);
      }}
      onKeyDown={onKey}
    >
      <div
        className="map-world"
        style={{
          transform: `translate(${String(v.x)}px, ${String(v.y)}px) scale(${String(v.z)})`,
          // Unseen until framed, so boxes never jump from the corner as a map opens.
          visibility: view ? "visible" : "hidden",
        }}
      >
        <svg className="map-edges" aria-hidden="true">
          <defs>
            <marker
              id="map-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="map-arrowhead" />
            </marker>
          </defs>
          {edges}
          {links}
          {drawing}
        </svg>
        {boxes.map((b) =>
          b.fold ? (
            <button
              key={b.id}
              type="button"
              className={`map-fold${b.fold.open ? " open" : ""}`}
              title={
                b.fold.open
                  ? "Fold the options not picked"
                  : "The options not picked: open to explore one or switch to it"
              }
              style={{ left: b.x - b.w / 2, top: b.y, width: b.w, transform: "translateY(-50%)" }}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onClick={() => {
                const key = b.id;
                setUnfolded((u) => {
                  const next = new Set(u);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
            >
              {b.heading} <span className="quiet">{b.fold.open ? "▾" : "▸"}</span>
            </button>
          ) : (b.kind === "option" || b.kind === "edit") && b.option ? (
            <div
              key={b.id}
              role="button"
              tabIndex={-1}
              className={
                b.kind === "edit"
                  ? "map-option edit"
                  : b.notPicked
                    ? "map-option not-picked"
                    : b.exploring
                      ? "map-option explored exploring"
                      : b.explored
                        ? "map-option explored"
                        : "map-option"
              }
              data-peek={b.id}
              title={
                b.kind === "edit"
                  ? "An edit a thread proposed: Use puts it in the doc"
                  : b.notPicked
                    ? "Not picked: open it to explore, or to use it instead"
                    : "An option from a thread: open it to pick"
              }
              style={{ left: b.x - b.w / 2, top: b.y, width: b.w, transform: "translateY(-50%)" }}
              onPointerDown={(e) => {
                onBoxDown(e, b);
              }}
            >
              {hand ? <BoxSketch id={b.id} w={b.w} h={b.h} dashed={b.kind === "edit"} /> : null}
              <div className="map-box-head">
                <span className="map-box-name">{b.option.title}</span>
                {b.kind === "edit" && writable && b.thread ? (
                  <button
                    type="button"
                    className="map-use"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const path = tree.sections[b.index]?.path;
                      if (!path || !b.thread) return;
                      window.dispatchEvent(
                        new CustomEvent("anur:use-preview", {
                          detail: { thread: b.thread.id, path },
                        }),
                      );
                    }}
                  >
                    Use
                  </button>
                ) : null}
              </div>
              {b.sub ? <div className="map-box-sub">{b.sub}</div> : null}
            </div>
          ) : b.kind === "link" && b.link ? (
            <button
              key={b.id}
              type="button"
              className={`map-linkbox${b.link.doc ? "" : " broken"}`}
              style={{ left: b.x - b.w / 2, top: b.y - b.h / 2, width: b.w, height: b.h }}
              title={
                b.link.doc
                  ? `Opens ${b.link.doc}${b.link.heading ? ` at ${b.link.heading.split("#").join(" › ")}` : ""}`
                  : "No doc by that name in the folder"
              }
              onPointerDown={(e) => {
                onBoxDown(e, b);
              }}
            >
              {hand ? <BoxSketch id={b.id} w={b.w} h={b.h} dashed={false} /> : null}
              <span className="truncate">→ {b.heading}</span>
            </button>
          ) : b.kind === "action" && b.act && b.thread ? (
            <div
              key={b.id}
              role="button"
              tabIndex={-1}
              className={`map-action ${b.act.state}`}
              data-peek={b.id}
              style={{ left: b.x - b.w / 2, top: b.y, width: b.w, transform: "translateY(-50%)" }}
              onPointerDown={(e) => {
                onBoxDown(e, b);
              }}
            >
              <div className="map-action-head">
                <span className="map-action-tag">{b.act.tag}</span>
                {servicesUsed(b.thread.items)
                  .slice(0, 2)
                  .map((sv) => (
                    <ServiceIcon key={sv.name} service={sv} />
                  ))}
                <span className="map-action-name truncate">{b.heading}</span>
              </div>
              <div className="map-action-foot">
                <span className={`map-action-state ${b.act.state}`}>
                  {ACTION_STATE[b.act.state]}
                </span>
                {/* A few words only where they tell something new: the step under way, why it failed. */}
                <span className="map-action-detail truncate">
                  {b.act.state === "running" || b.act.state === "failed" ? b.act.detail : ""}
                </span>
                {writable ? (
                  <ActionControl
                    act={b.act}
                    thread={b.thread}
                    docPath={docPath}
                    docText={docText}
                  />
                ) : null}
              </div>
            </div>
          ) : b.kind === "thread" && b.thread ? (
            <button
              key={b.id}
              type="button"
              className={`map-thread${b.thread.busy ? " busy" : ""}`}
              style={{ left: b.x - b.w / 2, top: b.y - b.h / 2, width: b.w, height: b.h }}
              title={b.thread.title}
              onPointerDown={(e) => {
                onBoxDown(e, b);
              }}
            >
              {hand ? <BoxSketch id={b.id} w={b.w} h={b.h} dashed /> : null}
              {/* The services it acted in, such as Linear or Gmail, by their marks. */}
              {servicesUsed(b.thread.items)
                .slice(0, MARKS_SHOWN)
                .map((sv) => (
                  <span key={sv.name} title={sv.name} className="map-thread-mark">
                    <ServiceIcon service={sv} />
                  </span>
                ))}
              <span className="truncate">
                <ThreadName thread={b.thread} />
              </span>
              {previewed.has(b.thread.id) ? (
                <span className="map-dot" aria-label="Has a preview" />
              ) : null}
            </button>
          ) : (
            <div
              key={b.id}
              role="button"
              tabIndex={-1}
              aria-pressed={b.index === selected}
              data-section={b.index}
              data-peek={`s:${String(b.index)}`}
              className={`map-box${b.side === 0 ? " title" : ""}${b.index === selected ? " selected" : ""}${drag?.id === b.id ? " dragging" : ""}${linking?.over === b.index ? " link-target" : ""}`}
              // Centred on its slot at its own height: the layout's height is an estimate.
              style={{ left: b.x - b.w / 2, top: b.y, width: b.w, transform: "translateY(-50%)" }}
              onPointerDown={(e) => {
                onBoxDown(e, b);
              }}
              onDoubleClick={() => {
                if (writable) setRenaming(b.index);
              }}
            >
              {hand ? <BoxSketch id={b.id} w={b.w} h={b.h} dashed={b.kind === "edit"} /> : null}
              <div className="map-box-head">
                {renaming === b.index ? (
                  <input
                    className="map-rename"
                    aria-label="Section name"
                    defaultValue={b.heading}
                    autoFocus
                    onFocus={(e) => {
                      e.currentTarget.select();
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      // Enter or Tab names it.
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                      if (e.key === "Escape") {
                        const fresh = freshIndex === b.index;
                        cancelRename.current = true;
                        setRenaming(null);
                        setFreshIndex(null);
                        // A section a key just made, left as it was: taken back out.
                        if (fresh && onDelete(b.index)) {
                          record({ kind: "doc" });
                          onSelect(tree.sections[b.index]?.parent ?? 0);
                        }
                        host.current?.focus();
                      }
                    }}
                    onBlur={(e) => {
                      if (cancelRename.current) {
                        cancelRename.current = false;
                        return;
                      }
                      const name = e.currentTarget.value.trim();
                      setRenaming(null);
                      setFreshIndex(null);
                      if (name && name !== b.heading) {
                        onRename(b.index, name);
                        record({ kind: "doc" });
                      }
                      host.current?.focus();
                    }}
                  />
                ) : (
                  <span className="map-box-name">{b.heading}</span>
                )}
                {b.outLinks ? (
                  <button
                    type="button"
                    className={`map-linkcount${openLinks === b.id ? " open" : ""}`}
                    title="Links to other docs"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      const view = host.current?.getBoundingClientRect();
                      setLinksUp(view ? r.top - view.top > view.height / 2 : false);
                      setOpenLinks((o) => (o === b.id ? null : b.id));
                    }}
                  >
                    → {String(b.outLinks.length)}
                  </button>
                ) : null}
              </div>
              {openLinks === b.id && b.outLinks ? (
                <div
                  className={`map-linklist${linksUp ? " up" : ""}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {b.outLinks.map((l) => (
                    <button
                      key={l.label}
                      type="button"
                      className={l.doc ? "map-linkitem" : "map-linkitem broken"}
                      disabled={!l.doc}
                      onClick={() => {
                        setOpenLinks(null);
                        if (l.doc)
                          window.dispatchEvent(
                            new CustomEvent("anur:open-path", {
                              detail: { path: l.doc, heading: l.heading },
                            }),
                          );
                      }}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {/* A section is just its name (Mock 10): its threads and actions hang off it. */}
              {writable
                ? (["left", "right", "top", "bottom"] as const).map((h) => (
                    <span
                      key={h}
                      className={`map-handle ${h}`}
                      title="Drag to a new box, or onto a box to link it"
                      onPointerDown={(e) => {
                        onHandleDown(e, b);
                      }}
                    />
                  ))
                : null}
            </div>
          ),
        )}
        <svg className={`map-ink${pen === "erase" ? " erasing" : ""}`} aria-hidden="true">
          {ink.map((st) => {
            const pts = inkPoints(st);
            if (!pts) return null;
            const d = inkPath(pts);
            return (
              <g key={st.id}>
                <path className="map-ink-stroke" d={d} />
                {pen === "erase" ? (
                  <path
                    className="map-ink-hit"
                    d={d}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      eraseInk(st.id);
                    }}
                  />
                ) : null}
              </g>
            );
          })}
          {inkNow ? <path className="map-ink-stroke" d={inkPath(inkNow)} /> : null}
        </svg>
      </div>
      {pen === "draw" ? (
        <div className="map-pen-catch" aria-label="Draw on the map" onPointerDown={onPenDown} />
      ) : null}
      {adding ? (
        <input
          className="map-add"
          style={{ left: adding.screen.x, top: adding.screen.y }}
          autoFocus
          placeholder="New section's name"
          aria-label="New section's name"
          onKeyDown={(e) => {
            if (e.key === "Enter") add(e.currentTarget.value);
            if (e.key === "Escape") setAdding(null);
            e.stopPropagation();
          }}
          onBlur={(e) => {
            add(e.currentTarget.value);
          }}
        />
      ) : null}
      {(() => {
        // An action: what it will do, or what its thread last said it did.
        const act = peek ? byId.get(peek) : undefined;
        if (act?.kind === "action" && act.act && act.thread && !drag && !linking) {
          const said = act.thread.items.findLast((x) => x.kind === "message" && x.role === "agent");
          const body =
            act.act.state === "planned"
              ? (act.act.what ?? "")
              : said?.kind === "message"
                ? said.text
                : "";
          const r = host.current?.getBoundingClientRect();
          const right = (act.x + act.w / 2) * v.z + v.x + 12;
          const left = (act.x - act.w / 2) * v.z + v.x - 12 - 320;
          const x = r && right + 320 > r.width ? Math.max(8, left) : right;
          const y = Math.max(
            8,
            Math.min((act.y - act.h / 2) * v.z + v.y, (r?.height ?? 600) - 320 - 60),
          );
          return (
            <div
              className="map-peek"
              style={{ left: x, top: y }}
              role="note"
              aria-label={act.heading}
            >
              <div className="map-peek-name">
                {act.act.tag === "CHECK" ? "Check" : "Build"} · {ACTION_STATE[act.act.state]}:{" "}
                {act.heading}
              </div>
              {body ? <Markdown text={body} /> : <p className="quiet">Nothing said yet.</p>}
            </div>
          );
        }
        const opt = peek?.startsWith("o:") || peek?.startsWith("p:") ? byId.get(peek) : undefined;
        const s = peek?.startsWith("s:") ? tree.sections[Number(peek.slice(2))] : undefined;
        const b = opt ?? (s ? byId.get(idOf(s.index)) : undefined);
        if (!b || drag || linking || (!s && !opt?.option)) return null;
        const name = opt?.option ? opt.option.title : (s?.path.at(-1) ?? "");
        const body = opt?.option ? opt.option.text : s ? bodyOf(docText(), s) : "";
        const r = host.current?.getBoundingClientRect();
        const right = (b.x + b.w / 2) * v.z + v.x + 12;
        const left = (b.x - b.w / 2) * v.z + v.x - 12 - 320;
        const x = r && right + 320 > r.width ? Math.max(8, left) : right;
        const y = Math.max(8, Math.min((b.y - b.h / 2) * v.z + v.y, (r?.height ?? 600) - 320 - 60));
        return (
          <div
            className="map-peek"
            style={{ left: x, top: y }}
            role="note"
            aria-label={`${name}: its text`}
          >
            <div className="map-peek-name">
              {opt?.kind === "edit"
                ? `Proposed edit to ${tree.sections[opt.index]?.path.at(-1) ?? ""}`
                : opt
                  ? `Option: ${name}`
                  : name}
            </div>
            {body ? <Markdown text={body} /> : <p className="quiet">No text yet.</p>}
          </div>
        );
      })()}
      {(() => {
        // Only the marks on this map (17.1); before any thread, what will appear.
        const has = (k: Box["kind"]) => boxes.some((b) => b.kind === k);
        const withPreview = boxes.some(
          (b) => b.kind === "thread" && b.thread && previewed.has(b.thread.id),
        );
        const keys = [
          { cls: "section", label: "Section", on: true },
          {
            cls: "thread",
            label: "Thread",
            on: boxes.some((b) => b.kind === "thread" && !(b.thread && previewed.has(b.thread.id))),
          },
          { cls: "preview", label: "Thread with a preview", on: withPreview },
          { cls: "option", label: "Option", on: has("option") },
          { cls: "edit", label: "Proposed edit", on: has("edit") },
          { cls: "link", label: "Link", on: has("link") },
          { cls: "link", label: "Link in the text", on: inText.length > 0 },
        ].filter((k) => k.on);
        if (!has("thread"))
          return (
            <div className="map-legend map-hint">
              Ask on a section and its thread appears here, under it.
            </div>
          );
        return (
          <div className="map-legend" aria-hidden="true">
            {keys.map((k) => (
              <span key={k.label}>
                <i className={`map-key ${k.cls}`} /> {k.label}
              </span>
            ))}
          </div>
        );
      })()}
      {writable ? <KeyBar /> : null}
      {note ? (
        <div className="map-note" role="status">
          {note}
        </div>
      ) : null}
      <div className="map-tools">
        <button
          type="button"
          className="map-tool"
          title={
            layout === "mind"
              ? "Lay the map out as a tree, read top down"
              : "Lay the map out as a mind map, the title in the middle"
          }
          onClick={() => {
            setLayout(layout === "mind" ? "tree" : "mind");
            userMoved.current = false;
            setView(null);
          }}
        >
          {layout === "mind" ? "Mind map" : "Tree"}
        </button>
        <button
          type="button"
          className="map-tool"
          title="Fit the whole map in view"
          onClick={() => {
            userMoved.current = false;
            fitAll.current = true;
            setView(null);
          }}
        >
          Fit
        </button>
        <button
          type="button"
          className="map-tool"
          title="Put moved boxes back in the layout"
          disabled={Object.keys(moved).length === 0}
          onClick={() => {
            moveBoxes(Object.fromEntries(Object.keys(moved).map((id) => [id, null])));
          }}
        >
          Tidy
        </button>
        <button
          type="button"
          className="map-tool"
          title="Sketch on a copy of this map in Excalidraw (⌘-click: open it in a new tab)"
          disabled={!writable || makingDrawing}
          onClick={(e) => {
            const newTab = e.metaKey || e.ctrlKey;
            setMakingDrawing(true);
            void openAsDrawing(newTab).finally(() => {
              setMakingDrawing(false);
            });
          }}
        >
          Sketch
        </button>
        <button
          type="button"
          className={`map-tool${pen === "draw" ? " on" : ""}`}
          title="Draw on the map; strokes stay with the box they're nearest (Esc to stop)"
          aria-pressed={pen === "draw"}
          disabled={!writable}
          onClick={() => {
            setPen((p) => (p === "draw" ? "off" : "draw"));
          }}
        >
          Pen
        </button>
        {ink.length > 0 ? (
          <button
            type="button"
            className={`map-tool${pen === "erase" ? " on" : ""}`}
            title="Click a stroke to erase it (Esc to stop)"
            aria-pressed={pen === "erase"}
            disabled={!writable}
            onClick={() => {
              setPen((p) => (p === "erase" ? "off" : "erase"));
            }}
          >
            Erase
          </button>
        ) : null}
        <span className="map-zoom quiet">{Math.round(v.z * 100)}%</span>
      </div>
    </div>
  );
}

const KEYS: readonly (readonly [string, string])[] = [
  ["Tab", "a section under it"],
  ["Enter", "one beside it"],
  ["F2", "rename"],
  ["⌫", "remove an empty one"],
  ["← → ↑ ↓", "move"],
];
const KEYS_SEEN = "anur.map.keysSeen";

/**
 * The map's keys (mock 8): in full the first time, then only the keys,
 * spelled out again on hover.
 */
function KeyBar() {
  const [first] = useState(() => {
    try {
      return !localStorage.getItem(KEYS_SEEN);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEYS_SEEN, "1");
    } catch {
      // Without storage it shows in full each time; nothing breaks.
    }
  }, []);
  return (
    <div className={`map-keys${first ? " open" : ""}`} aria-label="Map keys">
      {KEYS.map(([k, what]) => (
        <span key={k}>
          <kbd>{k}</kbd>
          <span className="map-keys-what">{what}</span>
        </span>
      ))}
    </div>
  );
}

const ACTION_STATE: Record<NonNullable<Box["act"]>["state"], string> = {
  planned: "Planned",
  running: "Running",
  needs: "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/**
 * An action box's one control (Mock 10). A done action only opens: running it
 * again could send or file things twice, so that's in its thread, asked first.
 */
function ActionControl({
  act,
  thread,
  docPath,
  docText,
}: {
  act: NonNullable<Box["act"]>;
  thread: ThreadView;
  docPath: string;
  docText: () => string;
}) {
  const say = (message: string) => {
    void anur.call("thread:send", { thread: thread.id, path: docPath, text: docText(), message });
  };
  const button = (label: string, run: () => void, primary = false) => (
    <button
      type="button"
      className={`map-action-go${primary ? " primary" : ""}`}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        run();
      }}
    >
      {label}
    </button>
  );
  switch (act.state) {
    case "planned":
      return button(
        "▶ Run",
        () => {
          if (act.proposal)
            window.dispatchEvent(new CustomEvent("anur:run-action", { detail: act.proposal }));
        },
        true,
      );
    case "running":
      return button("■ Stop", () => {
        void anur.call("thread:stop", { thread: thread.id });
      });
    case "needs":
      return act.ask
        ? button(
            "Approve",
            () => {
              const ask = act.ask;
              if (ask)
                void anur.call("thread:permission", { request: ask.request, option: ask.option });
            },
            true,
          )
        : null;
    case "failed":
      return button("↻ Retry", () => {
        say(
          "That failed. Go on from the step that failed; don't redo anything that already worked, such as drafts, issues or messages already made.",
        );
      });
    case "stopped":
      return button("▶ Resume", () => {
        say(
          "Carry on from where you stopped; don't redo anything already done, such as drafts, issues or messages already made.",
        );
      });
    default:
      // Done: no control. Clicking the box opens its thread; running again is there, asked first.
      return null;
  }
}
