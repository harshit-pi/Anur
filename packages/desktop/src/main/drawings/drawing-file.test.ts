import { compressToBase64 } from "lz-string";
import { describe, expect, it } from "vitest";
import { emptyDrawing, findDrawing, isDrawing, sceneOf, withScene } from "./drawing-file.ts";

const scene = (texts: { id: string; text: string }[]) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [
      { id: "r1", type: "rectangle" },
      ...texts.map((t) => ({ id: t.id, type: "text", text: t.text })),
    ],
    appState: {},
    files: {},
  });

// The shape Obsidian's Excalidraw plugin writes, with made-up content.
const note = (block: string) => `---

excalidraw-plugin: parsed
tags: [excalidraw]

---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==


# Excalidraw Data

## Text Elements
Gateway ^aaa

Queue ^bbb

%%
## Drawing
${block}
%%
`;

describe("Excalidraw files", () => {
  it("knows a drawing by its name", () => {
    expect(isDrawing("Pictures/Flow.excalidraw.md")).toBe(true);
    expect(isDrawing("Flow.excalidraw")).toBe(true);
    expect(isDrawing("Flow.md")).toBe(false);
  });

  it("reads the scene from plain and compressed JSON, and from a bare .excalidraw", () => {
    const s = scene([{ id: "aaa", text: "Gateway" }]);
    expect(sceneOf(note("```json\n" + s + "\n```"), "a.excalidraw.md")).toBe(s);
    const packed = compressToBase64(s).replace(/(.{64})/g, "$1\n");
    expect(sceneOf(note("```compressed-json\n" + packed + "\n```"), "a.excalidraw.md")).toBe(s);
    expect(sceneOf(s, "a.excalidraw")).toBe(s);
  });

  it("writes a new scene back, keeps the frontmatter, and lists its words again", () => {
    const before = note("```json\n" + scene([{ id: "aaa", text: "Gateway" }]) + "\n```");
    const next = scene([{ id: "ccc", text: "Workers ×N" }]);
    const after = withScene(before, "a.excalidraw.md", next);
    expect(sceneOf(after, "a.excalidraw.md")).toBe(next);
    expect(after.startsWith("---\n\nexcalidraw-plugin: parsed")).toBe(true);
    expect(after).toContain("## Text Elements\nWorkers ×N ^ccc\n");
    expect(after).not.toContain("Gateway ^aaa");
  });

  it("starts a new drawing the plugin can open", () => {
    const made = emptyDrawing();
    expect(made).toContain("excalidraw-plugin: parsed");
    expect(JSON.parse(sceneOf(made, "x.excalidraw.md") ?? "")).toMatchObject({ elements: [] });
  });
});

describe("findDrawing", () => {
  const files = [
    "Design Bank/Pictures/Flow - Picture.excalidraw.md",
    "Other/Flow - Picture.excalidraw.md",
    "Sketch.excalidraw",
    "Notes.md",
  ];
  it("reads an embed's name as Obsidian does: .excalidraw is the .excalidraw.md note", () => {
    expect(findDrawing(files, "Flow - Picture.excalidraw", "Design Bank/Design 4.md")).toBe(
      "Design Bank/Pictures/Flow - Picture.excalidraw.md",
    );
    expect(findDrawing(files, "Sketch.excalidraw", "Notes.md")).toBe("Sketch.excalidraw");
    expect(findDrawing(files, "Notes", "x.md")).toBeNull();
  });
  it("takes the one beside the page first", () => {
    expect(findDrawing(files, "Flow - Picture.excalidraw", "Other/Page.md")).toBe(
      "Other/Flow - Picture.excalidraw.md",
    );
  });
});
