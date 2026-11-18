/**
 * The system tab's levels (group 20): the folder's repos on top, then one
 * level per click, through groups to parts, as the map opens one level at a time.
 */
export type SystemSection = { id: string; path: string[]; text: string; parent: string | null };

/** The fixed path the system tab shows instead of a doc. */
export const SYSTEM_TAB = "anur:system";

export type SystemBox = {
  id: string;
  kind: "repo" | "group" | "part";
  name: string;
  /** What it holds: "103 parts in 8 groups", "4 parts", or the part's own line. */
  line: string;
  /** Whether a click opens it. */
  opens: boolean;
  /** A repo with nothing found by rule. */
  empty: boolean;
  /** Part IDs it holds, itself for a part. */
  parts: string[];
  /** How many of those the person hasn't seen (20.6b). */
  unreviewed: number;
};

const plural = (n: number, one: string) => `${String(n)} ${n === 1 ? one : `${one}s`}`;

export function childrenOf(all: readonly SystemSection[], parent: string | null): SystemSection[] {
  return all.filter((s) => s.parent === parent);
}

/** Part IDs under a section, at any depth. */
export function partIdsUnder(all: readonly SystemSection[], id: string): string[] {
  return childrenOf(all, id).flatMap((c) =>
    c.id.startsWith("part:") ? [c.id] : partIdsUnder(all, c.id),
  );
}

/** Parts under a section, at any depth. */
export function partsUnder(all: readonly SystemSection[], id: string): number {
  return partIdsUnder(all, id).length;
}

const kindOf = (s: SystemSection): SystemBox["kind"] =>
  s.id.startsWith("part:") ? "part" : s.id.startsWith("group:") ? "group" : "repo";

/**
 * The boxes on one level. Repos sort by name, ignoring case, with those that
 * have nothing found last; groups keep their order, kinds before services.
 */
export function boxesAt(
  all: readonly SystemSection[],
  parent: string | null,
  reviewed: ReadonlySet<string> = new Set(),
): SystemBox[] {
  const boxes = childrenOf(all, parent).map((s): SystemBox => {
    const kind = kindOf(s);
    const name = s.path.at(-1) ?? s.id;
    const parts = kind === "part" ? [s.id] : partIdsUnder(all, s.id);
    const unreviewed = parts.filter((p) => !reviewed.has(p)).length;
    const base = { id: s.id, kind, name, parts, unreviewed };
    if (kind === "part") return { ...base, line: s.text, opens: false, empty: false };
    const kids = childrenOf(all, s.id);
    if (kids.length === 0) return { ...base, line: "No build file", opens: false, empty: true };
    const groups = kids.filter((k) => !k.id.startsWith("part:")).length;
    const line = groups
      ? `${plural(parts.length, "part")} in ${plural(groups, "group")}`
      : plural(parts.length, "part");
    return { ...base, line, opens: true, empty: false };
  });
  if (parent !== null) return boxes;
  return boxes.sort(
    (x, y) =>
      Number(x.empty) - Number(y.empty) ||
      x.name.localeCompare(y.name, undefined, { sensitivity: "base" }),
  );
}

/** The trail from the top to a section, for going back. */
export function trailTo(all: readonly SystemSection[], id: string | null): SystemSection[] {
  const byId = new Map(all.map((s) => [s.id, s]));
  const out: SystemSection[] = [];
  for (let at = id ? byId.get(id) : undefined; at; at = at.parent ? byId.get(at.parent) : undefined)
    out.unshift(at);
  return out;
}
