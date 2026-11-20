import { describe, expect, it } from "vitest";
import {
  buildTree,
  docCount,
  dropTarget,
  freeName,
  rangeBetween,
  renamed,
  topmost,
} from "./file-tree.ts";

describe("the file tree", () => {
  it("leaves Excalidraw drawings out, and a folder that held only drawings", () => {
    const tree = buildTree(
      ["Plan.md", "Excalidraw/Sketch.excalidraw.md", "notes/Idea.md", "notes/Flow.excalidraw.md"],
      ["Excalidraw", "notes", "Empty"],
      "name",
      {},
      ["board.excalidraw", "notes/photo.png"],
    );
    const names = (nodes: typeof tree): string[] =>
      nodes.flatMap((n) => [n.name, ...(n.kind === "folder" ? names(n.children) : [])]);
    expect(names(tree)).toEqual(["Empty", "notes", "Idea", "photo", "Plan"]);
  });

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

  it("shows empty folders, and sorts docs by name either way or by time", () => {
    const docs = ["a.md", "B.md", "c.md"];
    const names = (t: ReturnType<typeof buildTree>) => t.map((n) => n.name);
    expect(names(buildTree(docs, ["Empty"]))).toEqual(["Empty", "a", "B", "c"]);
    expect(names(buildTree(docs, ["Empty", "Zed"], "name-desc"))).toEqual([
      "Zed",
      "Empty",
      "c",
      "B",
      "a",
    ]);
    const times = { "a.md": [3, 1], "B.md": [1, 3], "c.md": [2, 2] } as const;
    expect(names(buildTree(docs, [], "modified", times))).toEqual(["a", "c", "B"]);
    expect(names(buildTree(docs, [], "created", times))).toEqual(["B", "c", "a"]);
  });
});

describe("files panel names", () => {
  it("pick a free name, case ignored", () => {
    expect(freeName(["Notes/Untitled.md"], "Notes", "Untitled", ".md")).toBe("Notes/Untitled 2.md");
    expect(freeName(["new folder"], "", "New folder")).toBe("New folder 2");
  });

  it("say where a drop lands, never inside itself or where it is", () => {
    expect(dropTarget("Plan.md", "Ideas")).toBe("Ideas/Plan.md");
    expect(dropTarget("Ideas/Plan.md", "")).toBe("Plan.md");
    expect(dropTarget("Ideas/Plan.md", "Ideas")).toBeNull();
    expect(dropTarget("Ideas", "Ideas/Deep")).toBeNull();
    expect(dropTarget("Ideas", "Ideas")).toBeNull();
  });

  it("turn a typed name into a path beside the old one", () => {
    expect(renamed("Ideas/Plan.md", "Plan B", false)).toBe("Ideas/Plan B.md");
    expect(renamed("Ideas/Plan.md", " a/b: c ", false)).toBe("Ideas/a b c.md");
    expect(renamed("Ideas", "Thoughts", true)).toBe("Thoughts");
    expect(renamed("Ideas/Plan.md", "  ", false)).toBeNull();
    expect(renamed("Plan.md", "..hidden", false)).toBe("hidden.md");
  });

  it("lists attachments among docs, by name, with their ending apart", () => {
    const tree = buildTree(["b.md"], ["img"], "name", {}, ["a.png", "img/c.pdf"]);
    expect(tree.map((n) => [n.kind, n.name])).toEqual([
      ["folder", "img"],
      ["file", "a"],
      ["doc", "b"],
    ]);
    expect(tree[1]).toEqual({ kind: "file", name: "a", ext: "png", path: "a.png" });
  });

  it("keep an attachment's ending when renamed", () => {
    expect(renamed("img/photo.png", "cover", false)).toBe("img/cover.png");
    expect(renamed("img/photo.png", "cover.png", false)).toBe("img/cover.png");
    expect(renamed("spec.pdf", "Spec v2", false)).toBe("Spec v2.pdf");
  });
});

describe("picking several rows", () => {
  const rows = ["A", "A/x.md", "B.md", "C.md"];
  it("⇧-click takes the run between, either way round", () => {
    expect(rangeBetween(rows, "A/x.md", "C.md")).toEqual(["A/x.md", "B.md", "C.md"]);
    expect(rangeBetween(rows, "C.md", "A")).toEqual(rows);
    expect(rangeBetween(rows, "gone.md", "B.md")).toEqual(["B.md"]);
  });
  it("a row inside a picked folder goes with the folder", () => {
    expect(topmost(["A", "A/x.md", "B.md"])).toEqual(["A", "B.md"]);
    expect(topmost(["AB.md", "A"])).toEqual(["AB.md", "A"]);
  });
});
