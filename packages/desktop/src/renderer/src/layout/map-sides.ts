import type { Placed } from "@anur/core";

/**
 * Every box's side in the mind map just drawn (30.35), for the next one to
 * keep. A set's fold, "N not picked", is named for its first choice
 * (`f:<option>` for `o:<option>`): it stands where that choice stood, so the
 * section a Use makes keeps the side its choices were on.
 */
export function sidesSeen(placed: ReadonlyMap<string, Placed>): Map<string, -1 | 1> {
  const seen = new Map<string, -1 | 1>();
  for (const [id, p] of placed) {
    if (p.side === 0) continue;
    seen.set(id, p.side);
    if (id.startsWith("o:")) seen.set(`f:${id.slice(2)}`, p.side);
  }
  return seen;
}
