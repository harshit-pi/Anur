import type { MapNode, Placed } from "@anur/core";

/**
 * Every box's side in the mind map just drawn (30.35), for the next one to
 * keep. A set's fold, "N not picked", is named for its first choice
 * (`f:<option>` for `o:<option>`): it stands where that choice stood. A
 * choice's label (`d:…`, or a thread's `t:…` with one named set) is also
 * kept by its decision's name, for the section a Use of it makes.
 */
export function sidesSeen(
  placed: ReadonlyMap<string, Placed>,
  nameOf: (id: string) => string | undefined = () => undefined,
): Map<string, -1 | 1> {
  const seen = new Map<string, -1 | 1>();
  for (const [id, p] of placed) {
    if (p.side === 0) continue;
    seen.set(id, p.side);
    if (id.startsWith("o:")) seen.set(`f:${id.slice(2)}`, p.side);
    const name = id.startsWith("d:") || id.startsWith("t:") ? nameOf(id) : undefined;
    if (name) seen.set(`name:${name.trim().toLowerCase()}`, p.side);
  }
  return seen;
}

/**
 * `seen`, with each of the title's new branches given the side of the
 * choice label of the same name: Use turns a set named "Retry tail spacing"
 * into a section of that name, which takes the side the set was on.
 */
export function withNames(
  nodes: readonly MapNode[],
  seen: ReadonlyMap<string, -1 | 1>,
  nameOf: (id: string) => string | undefined,
): Map<string, -1 | 1> {
  const out = new Map(seen);
  const root = nodes.find((n) => n.parent === null);
  for (const n of nodes) {
    if (!root || n.parent !== root.id || out.has(n.id)) continue;
    const name = nameOf(n.id);
    const side = name ? seen.get(`name:${name.trim().toLowerCase()}`) : undefined;
    if (side) out.set(n.id, side);
  }
  return out;
}
