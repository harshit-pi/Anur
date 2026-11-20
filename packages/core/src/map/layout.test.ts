import { describe, expect, it } from "vitest";
import { boxSize, keptSides, mapLayout, mindLayout, type MapNode } from "./layout.ts";

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
  ];
  const at = mapLayout(nodes);

  it("puts the title at the top and its sections in a row beneath it", () => {
    expect(at.get("title")).toMatchObject({ x: 0, y: 0, side: 0 });
    const y = (id: string) => at.get(id)?.y ?? NaN;
    for (const id of ["problem", "who", "retry", "channel"]) expect(y(id), id).toBeGreaterThan(0);
    expect(new Set(["problem", "who", "retry", "channel"].map(y)).size).toBe(1);
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
    expect(x("title")).toBeCloseTo((x("problem") + x("channel")) / 2);
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

describe("wrapping", () => {
  it("wraps a parent's children into rows of four, in reading order, without overlap", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const at = mapLayout([box("title", null), ...names.map((n) => box(n, "title"))]);
    const y = (id: string) => at.get(id)?.y ?? NaN;
    const x = (id: string) => at.get(id)?.x ?? NaN;
    expect(new Set(["a", "b", "c", "d"].map(y)).size).toBe(1);
    expect(y("e")).toBeGreaterThan(y("a"));
    expect(y("f")).toBe(y("g"));
    expect(x("a")).toBeLessThan(x("d"));
    expect(x("f")).toBeLessThan(x("g"));
    expect(at.get("a")?.row).toBe(0);
    expect(at.get("f")?.row).toBe(1);
    expect(at.get("title")?.rails).toHaveLength(2);
    // The spine runs left of every child.
    const spine = at.get("title")?.spine ?? 0;
    for (const n of names) expect(spine).toBeLessThan(x(n) - 80);
    const all = [...at.values()];
    for (const a of all)
      for (const b of all) {
        if (a === b) continue;
        const apart =
          Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2;
        expect(apart, `${a.id} and ${b.id}`).toBe(true);
      }
  });
});

describe("the mind map", () => {
  it("puts the title in the middle and splits its sections right and left", () => {
    const placed = mindLayout([
      box("t", null),
      box("a", "t"),
      box("b", "t"),
      box("c", "t"),
      box("d", "t"),
      box("a1", "a"),
    ]);
    expect(placed.get("t")).toMatchObject({ x: 0, y: 0, side: 0 });
    expect(["a", "b"].map((id) => placed.get(id)?.side)).toEqual([1, 1]);
    expect(["c", "d"].map((id) => placed.get(id)?.side)).toEqual([-1, -1]);
    // Read top down on each side; a child sits further out than its parent.
    expect(placed.get("a")?.y ?? 0).toBeLessThan(placed.get("b")?.y ?? 0);
    expect(placed.get("c")?.y ?? 0).toBeLessThan(placed.get("d")?.y ?? 0);
    expect(placed.get("a1")?.x ?? 0).toBeGreaterThan(placed.get("a")?.x ?? 0);
    expect(placed.get("a1")?.y).toBe(placed.get("a")?.y);
  });

  it("keeps a lone section on the right", () => {
    const placed = mindLayout([box("t", null), box("a", "t")]);
    expect(placed.get("a")).toMatchObject({ side: 1, y: 0 });
  });
});

describe("the mind map's sides", () => {
  it("keeps each box on the side it had when another is added", () => {
    const first = mindLayout([box("t", null), box("a", "t"), box("b", "t")]);
    const kept = new Map(
      ["a", "b"].map((id) => [id, (first.get(id)?.side ?? 1) as -1 | 1] as const),
    );
    const next = mindLayout([box("t", null), box("a", "t"), box("b", "t"), box("c", "t")], kept);
    expect(["a", "b"].map((id) => next.get(id)?.side)).toEqual(
      ["a", "b"].map((id) => kept.get(id)),
    );
    // The new box goes to the side holding less: here they're even, so right.
    expect(next.get("c")?.side).toBe(1);
  });
});

describe("sides kept when a box changes hands (30.35)", () => {
  it("gives a new section the side its boxes had, so Use doesn't swap the map round", () => {
    // Before Use: a Build's choices hang off its label, one of them explored,
    // with the explore thread's narrower choices off that one: all one branch.
    const before = [
      box("title", null),
      box("d:build", "title"),
      box("o:3days", "d:build"),
      box("o:24h", "d:build"),
      box("t:explore", "o:3days"),
      box("o:12h", "t:explore", 60),
      box("o:6h", "t:explore", 60),
      box("o:probe", "t:explore", 60),
    ];
    const first = mindLayout(before);
    const seen = new Map(
      [...first].flatMap(([id, p]) => (p.side === 0 ? [] : [[id, p.side] as const])),
    );
    // The map's fold of a set's choices is named for its first: it stands where that one stood.
    seen.set("f:3days", seen.get("o:3days") ?? 1);
    const was = first.get("o:12h")?.side;
    // After Use: the choices hang off a new section, the rest fold, and the
    // explore thread becomes a branch of its own.
    const after = [
      box("title", null),
      box("t:explore", "title"),
      box("o:12h", "t:explore", 60),
      box("o:6h", "t:explore", 60),
      box("o:probe", "t:explore", 60),
      box("s:window", "title"),
      box("f:3days", "s:window"),
    ];
    // Keeping only the title's own children, as before 30.35, swaps a branch over.
    const onlyOwn = new Map(
      [...seen].filter(([id]) => after.some((n) => n.id === id && n.parent === "title")),
    );
    expect(mindLayout(after, onlyOwn).get("s:window")?.side).not.toBe(first.get("o:3days")?.side);
    // Kept from the boxes under each branch, nothing moves sides.
    const second = mindLayout(after, keptSides(after, seen));
    expect(second.get("s:window")?.side).toBe(first.get("o:3days")?.side);
    expect(second.get("o:12h")?.side).toBe(was);
  });

  it("leaves a box with nothing seen before to the lighter side, and keeps nothing on a first map", () => {
    const nodes = [box("title", null), box("a", "title"), box("b", "title")];
    expect(keptSides(nodes, new Map()).size).toBe(0);
    expect(keptSides(nodes, new Map([["a", 1]])).has("b")).toBe(false);
  });
});
