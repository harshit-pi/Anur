import { describe, expect, it } from "vitest";
import { FileHistory, moveLabel, reversed } from "./file-history.ts";

describe("FileHistory", () => {
  it("undoes last first, redoes what was undone, and a new action ends redo", () => {
    const h = new FileHistory();
    h.record({ label: "New doc", kind: "create", paths: ["a.md"], gone: [] });
    h.record({ label: "Rename", kind: "move", moves: [{ from: "a.md", to: "b.md" }] });
    expect(h.labels()).toEqual({ undo: "Rename", redo: null });
    const step = h.takeUndo();
    expect(step?.label).toBe("Rename");
    if (step) h.undid(step);
    expect(h.labels()).toEqual({ undo: "New doc", redo: "Rename" });
    const again = h.takeRedo();
    if (again) h.redid(again);
    expect(h.labels()).toEqual({ undo: "Rename", redo: null });
    const back = h.takeUndo();
    if (back) h.undid(back);
    h.record({ label: "Move to Trash", kind: "trash", items: [] });
    expect(h.labels()).toEqual({ undo: "Move to Trash", redo: null });
  });

  it("keeps the last 50 steps", () => {
    const h = new FileHistory();
    for (let i = 0; i < 60; i++) h.record({ label: String(i), kind: "move", moves: [] });
    let n = 0;
    while (h.takeUndo()) n++;
    expect(n).toBe(50);
  });

  it("names a move that stays in its folder a rename, and turns moves back last first", () => {
    expect(moveLabel([{ from: "A/x.md", to: "A/y.md" }])).toBe("Rename");
    expect(moveLabel([{ from: "x.md", to: "A/x.md" }])).toBe("Move");
    expect(
      reversed([
        { from: "a", to: "X/a" },
        { from: "b", to: "X/b" },
      ]),
    ).toEqual([
      { from: "X/b", to: "b" },
      { from: "X/a", to: "a" },
    ]);
  });
});
