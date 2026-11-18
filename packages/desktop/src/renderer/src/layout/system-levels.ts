/**
 * The system tab's levels (group 20): the folder's repos on top, then one
 * level per click, through groups to parts, as the map opens one level at a time.
 */
export type SystemSection = { id: string; path: string[]; text: string; parent: string | null };

/** The fixed path the system tab shows instead of a doc. */
export const SYSTEM_TAB = "anur:system";

export type SystemBox = {
  id: string;
  name: string;
  /** What it holds: "103 parts in 8 groups", "4 parts", or the part's own line. */
  line: string;
  /** Whether a click opens it. */
  opens: boolean;
  /** A repo with nothing found by rule. */
  empty: boolean;
};

const plural = (n: number, one: string) => `${String(n)} ${n === 1 ? one : `${one}s`}`;

export function childrenOf(all: readonly SystemSection[], parent: string | null): SystemSection[] {
  return all.filter((s) => s.parent === parent);
}

/** Parts under a section, at any depth. */
export function partsUnder(all: readonly SystemSection[], id: string): number {
  return childrenOf(all, id).reduce(
    (n, c) => n + (c.id.startsWith("part:") ? 1 : partsUnder(all, c.id)),
    0,
  );
}

/**
 * The boxes on one level. Repos sort by name, ignoring case, with those that
 * have nothing found last; groups keep their order, kinds before services.
 */
export function boxesAt(all: readonly SystemSection[], parent: string | null): SystemBox[] {
  const boxes = childrenOf(all, parent).map((s): SystemBox => {
    const kids = childrenOf(all, s.id);
    const name = s.path.at(-1) ?? s.id;
    if (s.id.startsWith("part:"))
      return { id: s.id, name, line: s.text, opens: false, empty: false };
    if (kids.length === 0)
      return { id: s.id, name, line: "No build file", opens: false, empty: true };
    const parts = partsUnder(all, s.id);
    const groups = kids.filter((k) => !k.id.startsWith("part:")).length;
    const line = groups
      ? `${plural(parts, "part")} in ${plural(groups, "group")}`
      : plural(parts, "part");
    return { id: s.id, name, line, opens: true, empty: false };
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
