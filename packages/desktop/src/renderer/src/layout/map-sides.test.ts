import { describe, expect, it } from "vitest";
import type { MapNode, Placed } from "@anur/core";
import { sidesSeen, withNames } from "./map-sides.ts";

const at = (id: string, side: -1 | 0 | 1): [string, Placed] => [
  id,
  { id, x: 0, y: 0, w: 100, h: 40, side },
];
const node = (id: string, parent: string | null): MapNode => ({ id, parent, w: 100, h: 40 });

describe("the sides a mind map keeps (30.35)", () => {
  it("remembers every box but the title, and a set's fold where its first choice stood", () => {
    const seen = sidesSeen(new Map([at("s:title", 0), at("s:plan", 1), at("o:abc", -1)]));
    expect([...seen]).toEqual([
      ["s:plan", 1],
      ["o:abc", -1],
      ["f:abc", -1],
    ]);
  });

  it("gives the section a Use makes the side its choices' label was on", () => {
    const names: Record<string, string> = {
      "d:t1:o1": "Retry tail spacing",
      "s:7": "Retry tail spacing",
      "s:3": "Retry window",
    };
    const nameOf = (id: string) => names[id];
    const seen = sidesSeen(new Map([at("s:0", 0), at("s:3", 1), at("d:t1:o1", -1)]), nameOf);
    const after = [node("s:0", null), node("s:3", "s:0"), node("s:7", "s:0")];
    const kept = withNames(after, seen, nameOf);
    expect(kept.get("s:7")).toBe(-1);
    expect(kept.get("s:3")).toBe(1);
  });
});
