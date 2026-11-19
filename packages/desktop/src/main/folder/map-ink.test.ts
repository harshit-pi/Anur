import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DocId } from "@anur/core";
import { MapInk } from "./map-ink.ts";

const doc = "d0123456789abcdef0123456" as DocId;
const stroke = (id: string) => ({
  id,
  anchor: "s1",
  pts: [
    [0, 0],
    [5, 5],
  ] as [number, number][],
  color: "ink",
});

describe("pen strokes on the map", () => {
  it("keeps each device's strokes, and shows them all", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "anur-ink-"));
    await new MapInk(root, "mac-a").change(doc, [stroke("a1")], []);
    await new MapInk(root, "mac-b").change(doc, [stroke("b1")], []);
    const all = await new MapInk(root, "mac-a").read(doc);
    expect(all.map((s) => s.id).sort()).toEqual(["a1", "b1"]);
  });

  it("erases anyone's stroke without touching their file", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "anur-ink-"));
    await new MapInk(root, "mac-a").change(doc, [stroke("a1")], []);
    await new MapInk(root, "mac-b").change(doc, [stroke("b1")], ["a1"]);
    expect((await new MapInk(root, "mac-a").read(doc)).map((s) => s.id)).toEqual(["b1"]);
  });
});
