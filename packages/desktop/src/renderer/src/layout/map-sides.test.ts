import { describe, expect, it } from "vitest";
import type { Placed } from "@anur/core";
import { sidesSeen } from "./map-sides.ts";

const at = (id: string, side: -1 | 0 | 1): [string, Placed] => [
  id,
  { id, x: 0, y: 0, w: 100, h: 40, side },
];

describe("the sides a mind map keeps (30.35)", () => {
  it("remembers every box but the title, and a set's fold where its first choice stood", () => {
    const seen = sidesSeen(new Map([at("s:title", 0), at("s:plan", 1), at("o:abc", -1)]));
    expect([...seen]).toEqual([
      ["s:plan", 1],
      ["o:abc", -1],
      ["f:abc", -1],
    ]);
  });
});
