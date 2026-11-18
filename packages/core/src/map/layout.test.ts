import { describe, expect, it } from "vitest";
import { boxSize, mapLayout, type MapNode } from "./layout.ts";

const box = (id: string, parent: string | null, h = 40): MapNode => ({ id, parent, w: 160, h });

describe("mapLayout", () => {
  const nodes = [
    box("title", null),
    box("problem", "title"),
    box("who", "title"),
    box("retry", "title"),
    box("payday", "retry"),
    box("declines", "retry"),
    box("channel", "title"),
    box("metric", "title"),
  ];
  const at = mapLayout(nodes);

  it("puts the title at the top and its sections in a row beneath it", () => {
    expect(at.get("title")).toMatchObject({ x: 0, y: 0, side: 0 });
    const y = (id: string) => at.get(id)?.y ?? NaN;
    for (const id of ["problem", "who", "retry", "channel", "metric"])
      expect(y(id), id).toBeGreaterThan(0);
    expect(new Set(["problem", "who", "retry", "channel", "metric"].map(y)).size).toBe(1);
  });

  it("keeps reading order left to right, children a row further down, centred under their parent", () => {
    const x = (id: string) => at.get(id)?.x ?? NaN;
    const y = (id: string) => at.get(id)?.y ?? NaN;
    expect(x("problem")).toBeLessThan(x("who"));
    expect(x("who")).toBeLessThan(x("retry"));
    expect(x("retry")).toBeLessThan(x("channel"));
    expect(y("payday")).toBeGreaterThan(y("retry"));
    expect(x("retry")).toBeCloseTo((x("payday") + x("declines")) / 2);
    // The title sits over the middle of its row.
    expect(x("title")).toBeCloseTo((x("problem") + x("metric")) / 2);
  });

  it("never overlaps two boxes", () => {
    const all = [...at.values()];
    for (const a of all)
      for (const b of all) {
        if (a === b) continue;
        const apart =
          Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2;
        expect(apart, `${a.id} and ${b.id}`).toBe(true);
      }
  });

  it("gives the same picture for the same tree", () => {
    expect([...mapLayout(nodes).entries()]).toEqual([...at.entries()]);
  });
});

describe("boxSize", () => {
  it("grows with the text, within bounds, and never from the screen", () => {
    expect(boxSize("Problem", "").w).toBe(160);
    expect(boxSize("A very long heading that goes on and on and on", "").w).toBe(280);
    expect(boxSize("Retry timing", "Retry after 1, 3 and 7 days.").h).toBeGreaterThan(
      boxSize("Retry timing", "").h,
    );
  });
});
