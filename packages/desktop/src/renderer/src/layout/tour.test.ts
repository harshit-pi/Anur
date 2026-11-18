import { describe, expect, it } from "vitest";
import { TOUR, bubbleAt } from "./tour.ts";

describe("the tour", () => {
  it("is five steps at most, each a title and one or two sentences", () => {
    expect(TOUR.length).toBeLessThanOrEqual(5);
    for (const s of TOUR) {
      expect(s.title.length).toBeLessThan(40);
      expect(s.text.split(/[.:] /).length).toBeLessThanOrEqual(4);
    }
  });

  it("puts the bubble beside the lit area, inside the window", () => {
    const win = { width: 1400, height: 900 };
    const b = { width: 300, height: 160 };
    expect(bubbleAt({ left: 50, top: 60, width: 280, height: 700 }, "right", b, win)).toEqual({
      left: 346,
      top: 90,
    });
    // No room on the left: it stays inside, at the edge.
    expect(bubbleAt({ left: 100, top: 60, width: 500, height: 300 }, "left", b, win).left).toBe(12);
    // Above the status bar, and never past the bottom.
    expect(bubbleAt({ left: 10, top: 870, width: 200, height: 24 }, "top", b, win)).toEqual({
      left: 12,
      top: 694,
    });
  });
});
