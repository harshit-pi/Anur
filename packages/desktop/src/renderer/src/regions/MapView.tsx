import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { boxSize, mapLayout, type MapNode, type SectionTree } from "@anur/core";
import type { PreviewView, ThreadView } from "../../../shared/ipc-contract.ts";
import { anur } from "../bridge.ts";
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
  kind: "section" | "thread" | "option" | "edit";
  index: number;
  thread?: ThreadView;
  /** An option a thread offered for this section, not picked yet. */
  option?: { id: string; title: string; text: string };
  /** The person is exploring this option before picking. */
  explored?: boolean;
  /** The agent is working on this option now. */
  exploring?: boolean;
  /** The box's second line: what's under it, or what sets it apart. */
  sub?: string;
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
const pill = (title: string) => ({
  w: Math.max(150, Math.min(280, Math.round(title.length * 7.8 + 44))),
  h: 36,
});

/** A line of Markdown as plain words, for a box's second line. */
const plainLine = (text: string) =>
  (text.split("\n").find((l) => l.trim() && !/^\s*(#|\||```)/.test(l)) ?? "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/[*_`[\]]/g, "")
    .trim();
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const plural = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
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
  onUndo,
  onRedo,
  writable,
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
  /** Undo and redo the page's last edit. */
  onUndo: () => void;
  onRedo: () => void;
  /** False when the doc can't be edited: boxes still move, but none can be added. */
  writable: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  /** Section IDs by heading path, so a heading added above can't hand a box another's ID. */
  const [ids, setIds] = useState<Map<string, string>>(new Map());
  const [moved, setMoved] = useState<Record<string, Pos>>({});
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
  const textNow = useRef(docText);
  textNow.current = docText;

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
      // The second line: what's under the box, its sections and threads.
      const count = threads.filter((t) => samePath(t.path, s.path)).length;
      const kids = tree.sections.filter((x) => x.parent === s.index).length;
      const sub = [
        kids > 0 ? plural(kids, "section") : "",
        count > 0 ? plural(count, "thread") : "",
      ]
        .filter(Boolean)
        .join(", ");
      nodes.push({
        id,
        parent: s.parent === null ? null : idOf(s.parent),
        ...boxSize(heading, sub),
      });
      info.set(id, {
        id,
        kind: "section",
        index: s.index,
        heading,
        sub,
        parent: s.parent === null ? null : idOf(s.parent),
      });
      for (const t of threads.filter((t) => samePath(t.path, s.path))) {
        const tid = `t:${t.id}`;
        nodes.push({ id: tid, parent: id, ...pill(t.title) });
        info.set(tid, {
          id: tid,
          kind: "thread",
          index: s.index,
          thread: t,
          heading: t.title,
          parent: id,
        });
      }
      // Each thread's latest options, until one is picked: what the section could say.
      for (const t of threads.filter((t) => samePath(t.path, s.path))) {
        // Until one is picked: the latest first set, any explored from earlier
        // first sets, and the narrower sets found while exploring, each hanging
        // off the option it was found within.
        const offers = t.items.flatMap((x) => (x.kind === "options" ? [x] : []));
        if (offers.length === 0 || offers.some((x) => x.used)) continue;
        const firsts = offers.filter((x) => !x.within);
        const latestFirst = firsts.at(-1);
        const exploredIds = new Set(offers.flatMap((x) => x.explored));
        const shown = offers.flatMap((x) =>
          x.within
            ? x.options.map((o) => ({ o, under: x.within }))
            : x === latestFirst
              ? x.options.map((o) => ({ o, under: null }))
              : x.options.filter((o) => exploredIds.has(o.id)).map((o) => ({ o, under: null })),
        );
        const shownIds = new Set(shown.map((x) => x.o.id));
        for (const { o, under } of shown) {
          const oid = `o:${o.id}`;
          // Under the thread that offered it, or the option it narrows.
          const parentId = under && shownIds.has(under) ? `o:${under}` : `t:${t.id}`;
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
            heading: o.title,
            parent: parentId,
          });
        }
      }
      // An edit a thread proposed to this section: a dashed box until it's used or set aside.
      for (const p of previews) {
        const part = p.parts.find((x) => samePath(x.path, s.path));
        const t = threads.find((x) => x.id === p.thread);
        if (!part || !t) continue;
        const eid = `p:${p.thread}`;
        const firstLine = clip(plainLine(part.proposed.replace(/^#{1,6}[ \t].*\n?/, "")), 46);
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
      Number(n.id.startsWith("t:") || n.id.startsWith("o:") || n.id.startsWith("p:"));
    nodes.sort((a, b) => near(b) - near(a));
    const placed = mapLayout(
      [nodes.find((n) => n.parent === null), ...nodes.filter((n) => n.parent !== null)].filter(
        (n): n is MapNode => Boolean(n),
      ),
    );
    const out: Box[] = [];
    for (const [id, p] of placed) {
      const i = info.get(id);
      if (!i) continue;
      out.push({ ...i, x: p.x, y: p.y, w: p.w, h: p.h, side: p.side });
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
      }
    }
    for (const b of out) {
      if (b.kind !== "section") continue;
      const put = moved[b.id];
      if (put) {
        b.x = put.x;
        b.y = put.y;
      }
      if (drag?.id === b.id) {
        b.x += drag.dx;
        b.y += drag.dy;
      }
    }
    return out;
  }, [tree, threads, previews, idOf, moved, drag]);

  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);

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
    const z = Math.max(READABLE, all);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const title = boxes.find((b) => b.side === 0);
    if (z > all && title) setView({ x: r.width / 2 - title.x * z, y: 60 - Math.min(...ys) * z, z });
    else setView({ x: r.width / 2 - cx * z, y: r.height / 2 - cy * z, z });
  }, [boxes, view, loaded, waited]);

  // New boxes, such as a thread's options, come into view: the map fits
  // itself again, unless the person has panned or zoomed it.
  const count = boxes.length;
  const lastCount = useRef(count);
  useEffect(() => {
    // Only a map already framed is framed again: while the first fit is
    // pending, clearing the view here would undo it in the same commit.
    if (count > lastCount.current && !userMoved.current && view !== null) setView(null);
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
    if ((b.kind === "thread" || b.kind === "option" || b.kind === "edit") && b.thread) {
      onSelect(b.index);
      window.dispatchEvent(
        new CustomEvent("anur:open-thread", { detail: { thread: b.thread.id } }),
      );
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
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setDrag(null);
      if (!moving) return;
      const at = { x: b.x + (ev.clientX - start.x) / z, y: b.y + (ev.clientY - start.y) / z };
      moveBoxes({ [b.id]: at });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
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
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setLinking(null);
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
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  // Arrow keys move between boxes; Shift+arrow nudges the selected one.
  const onKey = (e: React.KeyboardEvent) => {
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
    if ((e.key === "Backspace" || e.key === "Delete") && writable) {
      e.preventDefault();
      const parent = tree.sections[selected]?.parent ?? 0;
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
    }
  };

  const v = view ?? { x: 0, y: 0, z: 1 };
  const edges = boxes.flatMap((b) => {
    const p = b.parent ? byId.get(b.parent) : undefined;
    if (!p) return [];
    // From the parent's bottom to the child's top, a soft S; sideways when a moved box sits beside.
    const below = b.y - b.h / 2 >= p.y + p.h / 2;
    const above = b.y + b.h / 2 <= p.y - p.h / 2;
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
    return [
      <path key={b.id} className={b.kind === "section" ? "map-edge" : "map-edge thread"} d={d} />,
    ];
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
  const links = tree.sections.flatMap((s) =>
    [...new Set(s.linksOut.filter((l) => l.sameDoc).map((l) => l.targetIndex))]
      .filter((t): t is number => t !== null && t !== s.index)
      .flatMap((t) => {
        const a = byId.get(idOf(s.index));
        const b = byId.get(idOf(t));
        if (!a || !b) return [];
        const p = edge(a, b);
        const q = edge(b, a);
        return [
          <line
            key={`${a.id}>${b.id}`}
            className="map-link"
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            markerEnd="url(#map-arrow)"
          />,
        ];
      }),
  );
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
          (b.kind === "option" || b.kind === "edit") && b.option ? (
            <div
              key={b.id}
              role="button"
              tabIndex={-1}
              className={
                b.kind === "edit"
                  ? "map-option edit"
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
                  : "An option from a thread: open it to pick"
              }
              style={{ left: b.x - b.w / 2, top: b.y, width: b.w, transform: "translateY(-50%)" }}
              onPointerDown={(e) => {
                onBoxDown(e, b);
              }}
            >
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
            >
              <div className="map-box-head">
                <span className="map-box-name">{b.heading}</span>
              </div>
              {(() => {
                const here = threads.filter((t) =>
                  samePath(t.path, tree.sections[b.index]?.path ?? []),
                );
                // A thread here needs you: options to pick, or an edit to use.
                const needs = here.some((t) => {
                  const offers = t.items.flatMap((x) => (x.kind === "options" ? [x] : []));
                  return (offers.length > 0 && !offers.some((x) => x.used)) || previewed.has(t.id);
                });
                return b.sub || needs ? (
                  <div
                    className="map-box-sub"
                    title={needs ? "A thread here needs you" : undefined}
                  >
                    {needs ? <span className="think-needs-dot" aria-label="Needs you" /> : null}
                    {b.sub}
                  </div>
                ) : null;
              })()}
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
      </div>
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
      <div className="map-legend" aria-hidden="true">
        <span>
          <i className="map-key section" /> Section
        </span>
        <span>
          <i className="map-key thread" /> Thread
        </span>
        <span>
          <i className="map-key preview" /> Thread with a preview
        </span>
        <span>
          <i className="map-key option" /> Option
        </span>
        <span>
          <i className="map-key edit" /> Proposed edit
        </span>
        <span>
          <i className="map-key link" /> Link
        </span>
      </div>
      <div className="map-tools">
        <button
          type="button"
          className="map-tool"
          title="Fit the map in view"
          onClick={() => {
            userMoved.current = false;
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
        <span className="map-zoom quiet">{Math.round(v.z * 100)}%</span>
      </div>
    </div>
  );
}
