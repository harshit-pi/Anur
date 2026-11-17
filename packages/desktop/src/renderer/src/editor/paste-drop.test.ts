import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { livePreview } from "./live-preview/live-preview.ts";
import { markdownSupport } from "./sections.ts";

const DOC = "We want to see **which named readers** opened it.";
const make = (doc = DOC, sel = 0) =>
  EditorState.create({
    doc,
    selection: EditorSelection.cursor(sel),
    extensions: [markdownSupport(), livePreview],
  });
const paste = (from: number, to: number, text: string, doc = DOC) =>
  make(doc, from).update({ changes: { from, to, insert: text }, userEvent: "input.paste" }).state;
const drag = (from: number, to: number, target: number, doc = DOC) =>
  make(doc)
    .update({
      changes: [
        { from, to },
        { from: target, insert: doc.slice(from, to) },
      ],
      userEvent: "move.drop",
    })
    .state.doc.toString();

describe("pasting with marks hidden", () => {
  it("pastes bold after bold without doubling the marks", () => {
    const at = DOC.indexOf(" opened");
    expect(paste(at, at, "**x**").doc.toString()).toBe(
      "We want to see **which named readersx** opened it.",
    );
  });

  it("pastes bold inside bold as part of it", () => {
    const at = DOC.indexOf(" named");
    expect(paste(at, at, " **x**").doc.toString()).toBe(
      "We want to see **which x named readers** opened it.",
    );
  });

  it("pastes plain text inside bold as bold, as typing there would", () => {
    const at = DOC.indexOf(" named");
    expect(paste(at, at, " new").doc.toString()).toBe(
      "We want to see **which new named readers** opened it.",
    );
  });

  it("pastes italic into plain text as written", () => {
    const at = DOC.indexOf("opened");
    expect(paste(at, at, "*really* ").doc.toString()).toBe(
      "We want to see **which named readers** *really* opened it.",
    );
  });

  it("pastes over a selection that half-covers hidden marks", () => {
    expect(paste(DOC.indexOf("see"), DOC.indexOf(" named"), "plain").doc.toString()).toBe(
      "We want to plain **named readers** opened it.",
    );
  });

  it("puts the caret after the pasted text", () => {
    const at = DOC.indexOf(" opened");
    const s = paste(at, at, " and *more*");
    expect(s.doc.sliceString(0, s.selection.main.head)).toMatch(/more\*?$/);
  });

  it("keeps a pasted line break's Markdown, closing formats around it", () => {
    const at = DOC.indexOf(" named");
    expect(paste(at, at + 1, "\n").doc.toString()).toBe(
      "We want to see **which**\n**named readers** opened it.",
    );
  });
});

describe("dragging with marks hidden", () => {
  it("moves bold text as bold, leaving the rest bold", () => {
    expect(drag(DOC.indexOf("named"), DOC.indexOf(" readers"), DOC.indexOf("it."))).toBe(
      "We want to see **which  readers** opened **named**it.",
    );
  });

  it("moves a selection that half-covers hidden marks as balanced bold", () => {
    expect(drag(DOC.indexOf("which"), DOC.indexOf(" opened"), DOC.indexOf("it."))).toBe(
      "We want to see  opened **which named readers**it.",
    );
  });

  it("moves text to another line", () => {
    const doc = "First **bold one** here.\n\nSecond line.";
    expect(drag(doc.indexOf("one"), doc.indexOf(" here") - 2, doc.indexOf("line"), doc)).toBe(
      // The space that was before "one" stays, as when deleting.
      "First **bold**  here.\n\nSecond **one**line.",
    );
  });
});

describe("pasting a web address over text", () => {
  it("links the selected text to it", () => {
    const doc = "Accept the invite here today.";
    const from = doc.indexOf("the invite");
    const after = paste(from, from + "the invite".length, "https://x.co/i", doc);
    expect(after.doc.toString()).toBe("Accept [the invite](https://x.co/i) here today.");
    expect(after.doc.sliceString(after.selection.main.head)).toBe(" here today.");
  });

  it("keeps the bold of a half-bold selection inside the link", () => {
    const from = DOC.indexOf("see");
    const after = paste(from, DOC.indexOf(" named"), "https://x.co");
    expect(after.doc.toString()).toBe(
      "We want to [see **which**](https://x.co) **named readers** opened it.",
    );
  });

  it("leaves the spaces around the selection outside the link", () => {
    const doc = "Go to the page now.";
    const from = doc.indexOf(" the");
    const after = paste(from, doc.indexOf(" now"), "https://x.co", doc);
    expect(after.doc.toString()).toBe("Go to [the page](https://x.co) now.");
  });

  it("replaces the text of a link as usual", () => {
    const doc = "See [the plan](https://a.b) now.";
    const from = doc.indexOf("plan");
    const after = paste(from, from + 4, "https://x.co", doc);
    expect(after.doc.toString()).not.toContain("](https://x.co)");
  });

  it("is a plain paste with nothing selected", () => {
    const doc = "Go now.";
    expect(paste(3, 3, "https://x.co ", doc).doc.toString()).toBe("Go https://x.co now.");
  });
});
