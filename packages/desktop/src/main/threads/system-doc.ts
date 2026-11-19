import {
  DocId,
  SYSTEM_DOC,
  SectionId,
  buildSectionTree,
  systemIdsOf,
  type SectionTree,
} from "@anur/core";

/**
 * The system map's virtual doc in main (29.1): the IDs of its sections are
 * the boxes' own, read from the text a window sends.
 */
export const SYSTEM_DOC_ID = DocId.parse("anur-system-map");

export function systemLocated(text: string): {
  doc: DocId;
  tree: SectionTree;
  ids: SectionId[];
  canon: ReadonlyMap<SectionId, SectionId>;
} {
  const tree = buildSectionTree(text, { fileName: "System" });
  const ids = systemIdsOf(tree, text).map((id) => SectionId.parse(id ?? "system"));
  return { doc: SYSTEM_DOC_ID, tree, ids, canon: new Map() };
}

export { SYSTEM_DOC };

/** The map as main last read it: each box's parent, and each line's two ends, as box IDs. */
export type SystemShape = {
  parents: ReadonlyMap<string, string | null>;
  /** A box's repo folder, from the opened folder. */
  repoDir: ReadonlyMap<string, string>;
  /** A box's name, as the map shows it. */
  names: ReadonlyMap<string, string>;
  /** A part's folder, from the opened folder: where docs it covers live. */
  dirs: ReadonlyMap<string, string>;
  edges: readonly {
    id: string;
    from: string;
    to: string;
    label: string;
    aliases?: readonly string[];
  }[];
};

/**
 * Whether a committed decision reaches a box on the map (29.8), what it's
 * on by name, and how near (as `reachOf`): a part's own, then one on a line
 * with an end in the box, then its repo's, then everywhere's. A doc's own
 * sections' decisions stay with the doc.
 */
export function systemReach(
  e: { scope: string; home: string; on?: string | null | undefined },
  box: string,
  shape: SystemShape,
): { label: string; reach: number } | null {
  const inside = (id: string, outer: string) => {
    for (let at: string | null | undefined = id; at; at = shape.parents.get(at))
      if (at === outer) return true;
    return false;
  };
  const part = /^part:(.+)$/.exec(e.scope)?.[1];
  if (part) {
    const id = `part:${part}`;
    if (id === box) return { label: e.on ?? "this part", reach: 0 };
    return inside(id, box) ? { label: e.on ?? "a part in it", reach: 1 } : null;
  }
  const edge = /^edge:(.+)$/.exec(e.scope)?.[1];
  if (edge) {
    // By its ID, or one it had before lines were named by repo IDs.
    const l = shape.edges.find((x) => x.id === edge || x.aliases?.includes(edge));
    if (!l) return null;
    const near = [l.from, l.to].some((end) => end === box || inside(end, box));
    // Or the box is inside the end, as a part of a repo the line reaches.
    const within = [l.from, l.to].some((end) => inside(box, end));
    return near || within ? { label: `on ${e.on ?? l.label}`, reach: 2 } : null;
  }
  if (e.scope === "everywhere") return { label: "everywhere", reach: 4 };
  if (e.scope.startsWith("section:")) return null;
  // "repo" or "folder:…" in the home it's kept in: the repo the box is in.
  const dir = shape.repoDir.get(box);
  return dir !== undefined && dir === e.home
    ? { label: `all of ${dir || "the folder"}`, reach: 3 }
    : null;
}

/**
 * How many decisions each box shows on the map (29.9), and how many of
 * them disagree with another there: a part's or group's own and its lines',
 * and for a repo its repo-wide ones too. Everywhere's aren't counted; they'd
 * be on every box.
 */
export function boxCounts(
  entries: readonly {
    id: string;
    kind: string;
    scope: string;
    home: string;
    ref: string | null;
    against?: string | null | undefined;
    on?: string | null | undefined;
  }[],
  shape: SystemShape,
  boxes: readonly string[],
): Record<string, { decided: number; disagree: number }> {
  const out: Record<string, { decided: number; disagree: number }> = {};
  const decisions = entries.filter((e) => e.kind === "decision");
  for (const box of boxes) {
    const repo = box.startsWith("repo:");
    const here = decisions.filter((e) => {
      const r = systemReach(e, box, shape);
      return !!r && (r.reach <= 2 || (repo && r.reach === 3));
    });
    if (!here.length) continue;
    const named = new Set(here.flatMap((e) => [e.id, ...(e.ref ? [e.ref] : [])]));
    const pairs = new Set<string>();
    for (const e of here)
      if (e.against && named.has(e.against)) {
        pairs.add(e.id);
        const other = here.find((x) => x.id === e.against || x.ref === e.against);
        if (other) pairs.add(other.id);
      }
    out[box] = { decided: here.length, disagree: pairs.size };
  }
  return out;
}
