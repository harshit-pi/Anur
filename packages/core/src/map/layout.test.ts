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

  it("puts the title in the middle and splits its sections right and left", () => {
    expect(at.get("title")).toMatchObject({ x: 0, y: 0, side: 0 });
    expect(["problem", "who", "retry"].map((id) => at.get(id)?.side)).toEqual([1, 1, 1]);
    expect(["channel", "metric"].map((id) => at.get(id)?.side)).toEqual([-1, -1]);
  });

  it("keeps reading order top to bottom on each side, and children further out", () => {
    const y = (id: string) => at.get(id)?.y ?? NaN;
    expect(y("problem")).toBeLessThan(y("who"));
    expect(y("who")).toBeLessThan(y("retry"));
    expect(at.get("payday")?.x ?? 0).toBeGreaterThan(at.get("retry")?.x ?? 0);
    expect(at.get("metric")?.x ?? 0).toBeLessThan(0);
    // A parent sits level with the middle of its children.
    expect(y("retry")).toBeCloseTo((y("payday") + y("declines")) / 2);
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
    expect(boxSize("Problem", "").w).toBe(140);
    expect(boxSize("A very long heading that goes on and on and on", "").w).toBe(260);
    expect(boxSize("Retry timing", "Retry after 1, 3 and 7 days.").h).toBeGreaterThan(
      boxSize("Retry timing", "").h,
    );
  });
});
