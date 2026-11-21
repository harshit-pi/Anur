import { describe, expect, it } from "vitest";
import { type Cluster, makeRoom, sizeOf } from "./map-room.ts";

const box = (l: number, t: number, w = 150, h = 40) => ({ l, t, r: l + w, b: t + h });
// The eval's map: Audience over Pricing, Pricing's three choices out to the right.
const audience = (cards: number): Cluster => ({
  id: "audience",
  y: 180,
  rects: [
    box(360, 160),
    ...Array.from({ length: cards }, (_, k) => box(670, 150 + k * 70, 170, 58)),
  ],
});
const pricing: Cluster = {
  id: "pricing",
  y: 260,
  rects: [box(360, 240), box(670, 120, 170, 58), box(670, 190, 170, 58), box(670, 260, 170, 58)],
};
const risks: Cluster = { id: "risks", y: 420, rects: [box(360, 400), box(670, 380, 170, 40)] };
const title: Cluster = { id: "title", y: 220, pinned: true, rects: [box(150, 200)] };

describe("making room when cards arrive on a section", () => {
  it("slides the neighbour away from the one that grew, which stays put", () => {
    const dy = makeRoom([title, audience(2), pricing], new Set(["audience"]));
    expect(dy.has("audience")).toBe(false);
    // Audience's lower card ends at 278; Pricing's top card starts at 120.
    expect(dy.get("pricing")).toBe(278 + 12 - 120);
  });

  it("pushes on to the next one when the slide reaches it", () => {
    const dy = makeRoom([title, audience(2), pricing, risks], new Set(["audience"]));
    const p = dy.get("pricing") ?? 0;
    expect(dy.get("risks")).toBe(260 + 58 + p + 12 - 380);
  });

  it("slides one above upward", () => {
    const above: Cluster = { id: "above", y: 100, rects: [box(670, 90, 170, 58)] };
    const dy = makeRoom([above, audience(2)], new Set(["audience"]));
    expect(dy.get("above")).toBe(-(90 + 58 + 12 - 150));
  });

  it("moves nothing that isn't in the way, and never the title", () => {
    const far: Cluster = { id: "far", y: 900, rects: [box(360, 880)] };
    const left: Cluster = { id: "left", y: 180, rects: [box(-200, 150, 170, 200)] };
    const dy = makeRoom([title, audience(2), far, left], new Set(["audience"]));
    expect(dy.size).toBe(0);
    const big: Cluster = { id: "big", y: 220, rects: [box(100, 190, 300, 80)] };
    expect(makeRoom([title, big], new Set(["big"])).has("title")).toBe(false);
  });

  it("parts two that grew at once, the lower one going down", () => {
    const dy = makeRoom([audience(2), pricing], new Set(["audience", "pricing"]));
    expect(dy.has("audience")).toBe(false);
    expect(dy.get("pricing")).toBeGreaterThan(0);
  });

  it("tells growth by the cluster's size", () => {
    expect(sizeOf(audience(2))).toBeGreaterThan(sizeOf(audience(0)));
    expect(sizeOf(audience(2))).toBe(sizeOf(audience(2)));
  });
});
