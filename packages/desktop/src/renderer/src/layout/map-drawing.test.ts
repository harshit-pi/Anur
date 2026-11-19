import { describe, expect, it } from "vitest";
import { mapSkeleton, type MapShape } from "./map-drawing.ts";

const shapes: MapShape[] = [
  {
    id: "s:0",
    kind: "section",
    x: 0,
    y: 0,
    w: 200,
    h: 60,
    heading: "Plan",
    sub: "2 sections",
    parent: null,
  },
  { id: "s:1", kind: "section", x: -120, y: 140, w: 180, h: 50, heading: "Pricing", parent: "s:0" },
  {
    id: "t:a",
    kind: "thread",
    x: -120,
    y: 240,
    w: 160,
    h: 36,
    heading: "Cheaper tier",
    parent: "s:1",
  },
];

describe("the map as a drawing", () => {
  it("draws a labelled box per map box, dashed for threads", () => {
    const sk = mapSkeleton(shapes, []);
    const boxes = sk.filter((e) => e.type === "rectangle");
    expect(boxes.map((b) => (b.label as { text: string }).text)).toEqual([
      "Plan\n2 sections",
      "Pricing",
      "Cheaper tier",
    ]);
    expect(boxes.map((b) => b.strokeStyle)).toEqual(["solid", "solid", "dashed"]);
    // Centred where the map has it, and wide enough for the hand-drawn font.
    const first = boxes[0] as { x: number; width: number };
    expect(first.x + first.width / 2).toBe(0);
    expect(first.width).toBeGreaterThanOrEqual(200);
  });

  it("joins each box to its parent, and draws links as dashed arrows", () => {
    const sk = mapSkeleton(shapes, [{ from: "s:1", to: "s:0" }]);
    const arrows = sk.filter((e) => e.type === "arrow");
    expect(
      arrows.map((a) => [(a.start as { id: string }).id, (a.end as { id: string }).id]),
    ).toEqual([
      ["s:0", "s:1"],
      ["s:1", "t:a"],
      ["s:1", "s:0"],
    ]);
    expect(arrows[2]?.strokeStyle).toBe("dashed");
  });
});
