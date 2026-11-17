import { describe, expect, it } from "vitest";
import { buildTree, docCount } from "./file-tree.ts";

describe("the file tree", () => {
  it("nests docs under their folders, folders first, names without .md", () => {
    const tree = buildTree(["A.md", "notes/Plan.md", "notes/deep/Idea.md", "b.md"]);
    expect(tree.map((n) => [n.kind, n.name])).toEqual([
      ["folder", "notes"],
      ["doc", "A"],
      ["doc", "b"],
    ]);
    const [notes] = tree;
    if (notes?.kind !== "folder") throw new Error("expected a folder");
    expect(notes.children.map((n) => [n.kind, n.name, n.path])).toEqual([
      ["folder", "deep", "notes/deep"],
      ["doc", "Plan", "notes/Plan.md"],
    ]);
    expect(docCount(notes)).toBe(2);
  });

  it("is empty for a folder with no docs", () => {
    expect(buildTree([])).toEqual([]);
  });
});
