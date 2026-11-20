import { describe, expect, it } from "vitest";
import { ownOffsets } from "./map-moves.ts";

const boxes = [
  { id: "s:plan", kind: "section", parent: null },
  { id: "t:ask", kind: "thread", parent: "s:plan" },
  { id: "o:fly", kind: "option", parent: "t:ask" },
  { id: "t:explore", kind: "thread", parent: "o:fly" },
  { id: "o:fly-eu", kind: "option", parent: "t:explore" },
  { id: "o:render", kind: "option", parent: "t:ask" },
];

describe("a choice dragged on its own (30.35)", () => {
  it("moves it and what hangs off it, and nothing beside it", () => {
    const at = ownOffsets(boxes, { "o:fly": { x: 40, y: -10 } }, null);
    expect(at.get("o:fly")).toEqual({ dx: 40, dy: -10 });
    expect(at.get("o:fly-eu")).toEqual({ dx: 40, dy: -10 });
    expect(at.has("o:render")).toBe(false);
    expect(at.has("t:ask")).toBe(false);
  });

  it("adds a drag in progress to where it was put, and never moves a section", () => {
    const at = ownOffsets(boxes, { "o:fly": { x: 40, y: 0 } }, { id: "o:fly", dx: 5, dy: 5 });
    expect(at.get("t:explore")).toEqual({ dx: 45, dy: 5 });
    expect(ownOffsets(boxes, { "s:plan": { x: 300, y: 300 } }, null).size).toBe(0);
  });
});
