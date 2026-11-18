import { foldEffect, foldedRanges } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "../sections.ts";
import { sectionAt, sectionFolding, sectionRange } from "./section-fold.ts";

const DOC =
  "# Plan\n\nIntro.\n\n## Risks\n\nHost untested.\n\n### Deep\n\nMore.\n\n## Dates\n\nMonday.\n";

const stateOf = (doc = DOC) =>
  EditorState.create({ doc, extensions: [markdownSupport(), sectionFolding("Plan.md")] });
const lineAt = (s: EditorState, text: string) => s.doc.lineAt(s.doc.toString().indexOf(text));

describe("folding a section", () => {
  it("folds from the heading's end to the next heading of its level or higher", () => {
    const s = stateOf();
    const risks = lineAt(s, "## Risks");
    const range = sectionRange(s, risks.from);
    expect(s.sliceDoc(range?.from, range?.to)).toBe("\n\nHost untested.\n\n### Deep\n\nMore.");
    const deep = sectionRange(s, lineAt(s, "### Deep").from);
    expect(s.sliceDoc(deep?.from, deep?.to)).toBe("\n\nMore.");
    expect(sectionRange(s, lineAt(s, "Intro.").from)).toBeNull();
  });

  it("knows which section the pointer is in: the nearest heading whose fold reaches it", () => {
    const s = stateOf();
    const at = (text: string) => sectionAt(s, s.doc.toString().indexOf(text) + 1);
    expect(at("Host untested")).toBe(lineAt(s, "## Risks").from);
    expect(at("More.")).toBe(lineAt(s, "### Deep").from);
    expect(at("## Dates")).toBe(lineAt(s, "## Dates").from);
    expect(at("Intro.")).toBe(lineAt(s, "# Plan").from);
  });

  it("opens a folded section when the cursor is sent into it, as by the outline", () => {
    let s = stateOf();
    const range = sectionRange(s, lineAt(s, "## Risks").from);
    if (!range) throw new Error("no range");
    s = s.update({ effects: foldEffect.of(range) }).state;
    expect(foldedRanges(s).size).toBe(1);
    s = s.update({ selection: EditorSelection.cursor(s.doc.toString().indexOf("More.")) }).state;
    expect(foldedRanges(s).size).toBe(0);
  });

  it("never changes the text", () => {
    let s = stateOf();
    const range = sectionRange(s, lineAt(s, "# Plan").from);
    if (!range) throw new Error("no range");
    s = s.update({ effects: foldEffect.of(range) }).state;
    expect(s.doc.toString()).toBe(DOC);
  });
});
