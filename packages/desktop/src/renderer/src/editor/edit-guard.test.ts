import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { copyText } from "./inline-format.ts";
import { livePreview } from "./live-preview/live-preview.ts";
import { markdownSupport } from "./sections.ts";

const DOC = "We want to see **which named readers** opened it.";
const make = (doc = DOC, sel = 0) =>
  EditorState.create({
    doc,
    selection: EditorSelection.cursor(sel),
    extensions: [markdownSupport(), livePreview],
  });
const apply = (state: EditorState, spec: TransactionSpec) => state.update(spec).state;
const del = (from: number, to: number, doc = DOC, event = "delete.selection") =>
  apply(make(doc), { changes: { from, to }, userEvent: event }).doc.toString();
const type = (pos: number, text: string, doc = DOC) => {
  const s = apply(make(doc, pos), {
    changes: { from: pos, insert: text },
    selection: EditorSelection.cursor(pos + text.length),
    userEvent: "input.type",
  });
  return { text: s.doc.toString(), caret: s.selection.main.head };
};

describe("deleting with marks hidden", () => {
  it("removes visible text and keeps a format's marks when some of it stays", () => {
    expect(del(DOC.indexOf("see"), DOC.indexOf(" named"))).toBe(
      "We want to  **named readers** opened it.",
    );
    expect(del(DOC.indexOf(" readers"), DOC.indexOf(" opened"))).toBe(
      "We want to see **which named** opened it.",
    );
  });

  it("removes the marks too when all of a format's text goes", () => {
    expect(del(DOC.indexOf("which"), DOC.indexOf("** opened"))).toBe("We want to see  opened it.");
    expect(del(DOC.indexOf("see "), DOC.indexOf(" opened"))).toBe("We want to  opened it.");
  });

  it("Backspace beside hidden marks deletes the visible character", () => {
    const after = DOC.indexOf(" opened");
    // Right after the closing marks: CodeMirror deletes the atomic "**" and the "s".
    expect(del(after - 3, after, DOC, "delete.backward")).toBe(
      "We want to see **which named reader** opened it.",
    );
    // Only the marks in the way: the visible character before them goes.
    const start = DOC.indexOf("which");
    expect(del(start - 2, start, DOC, "delete.backward")).toBe(
      "We want to see**which named readers** opened it.",
    );
  });

  it("keeps a link's hidden address when part of its text is deleted", () => {
    const doc = "See [the tracker](https://x.com) now";
    expect(del(doc.indexOf("the "), doc.indexOf("tracker"), doc)).toBe(
      "See [tracker](https://x.com) now",
    );
    expect(del(doc.indexOf("the"), doc.indexOf("]("), doc)).toBe("See  now");
  });

  it("never leaves a stray ** when bold-italic can't follow the text kept", () => {
    // Deleting from inside bold up to a bold-italic quote: Markdown can't open
    // *** after a letter, so the quote loses its marks, both the italic and
    // the bold inside it, rather than show ** as text.
    const doc = '🔍 **look at the whole thing.** then say: ***"why not?"*** and go.';
    const out = del(doc.indexOf("t the"), doc.indexOf('***"'), doc);
    expect(out).not.toMatch(/\w\*/u);
    expect(out.replace(/\*/g, "")).toBe('🔍 look a"why not?" and go.');
  });

  it("deletes inside a wiki link's alias without breaking the link", () => {
    const doc = "Read [[Plan#Retry|the retry plan]] first";
    expect(del(doc.indexOf("retry plan"), doc.indexOf("]]"), doc)).toBe(
      "Read [[Plan#Retry|the ]] first",
    );
  });
});

describe("typing with marks hidden", () => {
  it("puts a space typed at the end of a bold word outside the marks", () => {
    const r = type(DOC.indexOf("** opened"), " ");
    expect(r.text).toBe("We want to see **which named readers**  opened it.");
    expect(r.caret).toBe(DOC.indexOf(" opened") + 1);
  });

  it("puts a space typed at the start of a bold word before the marks", () => {
    expect(type(DOC.indexOf("which"), " ").text).toBe(
      "We want to see  **which named readers** opened it.",
    );
  });

  it("keeps typing letters inside the format", () => {
    expect(type(DOC.indexOf("** opened"), "!").text).toBe(
      "We want to see **which named readers!** opened it.",
    );
  });

  it("closes and reopens a format when Enter replaces the space inside it", () => {
    const at = DOC.indexOf(" named");
    const s = apply(make(DOC, at), {
      changes: { from: at, to: at + 1, insert: "\n" },
      selection: EditorSelection.cursor(at + 1),
      userEvent: "input",
    });
    expect(s.doc.toString()).toBe("We want to see **which**\n**named readers** opened it.");
  });

  it("closes and reopens a format around a line break typed inside it", () => {
    expect(type(DOC.indexOf(" named"), "\n").text).toBe(
      "We want to see **which**\n** named readers** opened it.",
    );
  });
});

describe("copying with marks hidden", () => {
  it("copies part of bold text as bold, never half a pair", () => {
    const state = make();
    expect(copyText(state, DOC.indexOf("named"), DOC.indexOf(" readers"))).toBe("**named**");
    expect(copyText(state, DOC.indexOf("see"), DOC.indexOf(" named"))).toBe("see **which**");
  });

  it("copies across lines", () => {
    const doc = "One **bold\n\nTwo** plain";
    expect(copyText(make(doc), 0, doc.length)).toBe("One **bold\n\nTwo** plain");
  });
});
