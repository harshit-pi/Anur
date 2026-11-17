import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "../sections.ts";
import { buildLivePreview, parseProperties, splitRow } from "./live-preview.ts";
import { CheckboxWidget, PropertiesWidget, TableWidget } from "./widgets.ts";

/** A state with the cursor at `cursor` (default: past the end, on no line of interest). */
function stateOf(doc: string, cursor = doc.length) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdownSupport()],
  });
}

type Found = { from: number; to: number; text: string; cls: unknown; widget: unknown };

function decorations(doc: string, cursor?: number): Found[] {
  const state = stateOf(doc, cursor);
  const found: Found[] = [];
  buildLivePreview(state).between(0, doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: unknown; widget?: unknown };
    found.push({ from, to, text: doc.slice(from, to), cls: spec.class, widget: spec.widget });
  });
  return found;
}

/** The text live preview hides or replaces, in order. */
const hidden = (doc: string, cursor?: number) =>
  decorations(doc, cursor)
    .filter((d) => d.to > d.from && d.cls === undefined)
    .map((d) => d.text);

const widgetOf = <T>(doc: string, type: new (...args: never[]) => T, cursor?: number) =>
  decorations(doc, cursor)
    .map((d) => d.widget)
    .find((w): w is T => w instanceof type);

describe("live preview", () => {
  it("hides heading, emphasis, code and strike marks off the cursor line", () => {
    const doc = "## Title\n\nSome **bold**, *it*, `code` and ~~gone~~.\n\nend";
    expect(hidden(doc)).toEqual(["## ", "**", "**", "*", "*", "`", "`", "~~", "~~"]);
  });

  it("shows the source on the line the cursor is on", () => {
    const doc = "## Title\n\nSome **bold** here.\n";
    expect(hidden(doc, 3)).toEqual(["**", "**"]);
    expect(hidden(doc, 15)).toEqual(["## "]);
  });

  it("shows a Markdown link as its text", () => {
    const doc = "See [the plan](https://example.com/plan) now.\n\nend";
    expect(hidden(doc)).toEqual(["[", "](https://example.com/plan)"]);
    const link = decorations(doc).find((d) => d.cls === "cm-lp-link");
    expect(link?.text).toBe("the plan");
  });

  it("shows a wiki link as its alias, or as file › heading", () => {
    const aliased = "Read [[Design - Index#Editor|§ Editor]].\n\nend";
    expect(hidden(aliased)).toEqual(["[[Design - Index#Editor|", "]]"]);
    const plain = "Read [[Design - Index#Editor]].\n\nend";
    const shown = decorations(plain).filter((d) => d.cls === "cm-lp-link");
    expect(shown.map((d) => d.text)).toEqual(["Design - Index", "Editor"]);
  });

  it("draws bullets and task boxes", () => {
    const doc = "- one\n- [x] done\n- [ ] todo\n\nend";
    const boxes = decorations(doc)
      .map((d) => d.widget)
      .filter((w): w is CheckboxWidget => w instanceof CheckboxWidget);
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    expect(hidden(doc)).toEqual(["-", "- ", "[x]", "- ", "[ ]"]);
  });

  it("draws a table as a table until the cursor enters it", () => {
    const doc = "Intro\n\n| Name | Score |\n| :--- | ---: |\n| **A** | 1 |\n| B \\| C | 2 |\n\nend";
    const table = widgetOf(doc, TableWidget);
    expect(table?.header).toEqual(["Name", "Score"]);
    expect(table?.rows).toEqual([
      ["**A**", "1"],
      ["B \\| C", "2"],
    ]);
    expect(table?.align).toEqual(["left", "right"]);
    expect(widgetOf(doc, TableWidget, doc.indexOf("Score"))).toBeUndefined();
  });

  it("draws frontmatter as properties until the cursor enters it", () => {
    const doc = "---\ntitle: Plan\ntags: [a, b]\naliases:\n  - One\n---\n\n# Plan\n";
    expect(widgetOf(doc, PropertiesWidget)?.props).toEqual([
      ["title", ["Plan"]],
      ["tags", ["a", "b"]],
      ["aliases", ["One"]],
    ]);
    expect(widgetOf(doc, PropertiesWidget, 5)).toBeUndefined();
  });

  it("marks a callout's lines and shows its kind as a label", () => {
    const doc = "> [!warning] Careful\n> body\n\nend";
    const lines = decorations(doc).filter((d) => d.from === d.to);
    expect(lines.map((d) => d.cls)).toEqual([
      "cm-lp-callout cm-lp-callout-warning cm-lp-callout-first",
      "cm-lp-callout cm-lp-callout-warning",
    ]);
    expect(hidden(doc)).toEqual(["> ", "[!warning]", "> "]);
  });

  it("hides a code fence's marks but not its code", () => {
    const doc = "```js\nlet a = 1;\n```\n\nend";
    expect(hidden(doc)).toEqual(["```", "js", "```"]);
  });

  it("never changes the document", () => {
    const doc = "---\na: 1\n---\n\n| x |\n| - |\n| y |\n\n> [!note]\n> n\n";
    const state = stateOf(doc);
    buildLivePreview(state);
    expect(state.doc.toString()).toBe(doc);
  });
});

describe("frontmatter as properties", () => {
  it("reads quoted values and lists", () => {
    expect(parseProperties('a: "x: y"\nb:\n  - "1"\n  - 2')).toEqual([
      ["a", ["x: y"]],
      ["b", ["1", "2"]],
    ]);
  });

  it("gives up on YAML it can't show simply, leaving the source", () => {
    expect(parseProperties("a:\n  nested: 1")).toBeNull();
  });

  it("keeps a wiki link value whole", () => {
    expect(parseProperties("up: [[Parent]]")).toEqual([["up", ["[[Parent]]"]]]);
  });
});

describe("table rows", () => {
  it("split at pipes but not escaped ones", () => {
    expect(splitRow("| a | b \\| c |")).toEqual(["a", "b \\| c"]);
    expect(splitRow("a|b")).toEqual(["a", "b"]);
  });
});
