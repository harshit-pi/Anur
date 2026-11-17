import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { livePreview } from "./live-preview/live-preview.ts";
import { markdownSupport } from "./sections.ts";

/** Paste `text` at `find` in `doc` (or over it, with `over`), as the editor does. */
function paste(doc: string, find: string, text: string, over = 0) {
  const at = find === "" ? doc.length : doc.indexOf(find);
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(at),
    extensions: [markdownSupport(), livePreview],
  }).update({ changes: { from: at, to: at + over, insert: text }, userEvent: "input.paste" }).state;
  return { doc: state.doc.toString(), caret: state.selection.main.head };
}

describe("pasting several lines with marks hidden", () => {
  it("splits bold around the break, nothing doubled", () => {
    expect(paste("We want **which named readers** opened.", "named", "one\n\nthree").doc).toBe(
      "We want **which one**\n\n**threenamed readers** opened.",
    );
  });

  it("keeps pasted styles on both ends", () => {
    expect(paste("We want **which named readers** opened.", "named", "*one* two\nthree").doc).toBe(
      "We want **which *one* two**\n**threenamed readers** opened.",
    );
  });

  it("puts the caret after the last pasted line", () => {
    const { doc, caret } = paste("Text before here.", "here", "a\nb");
    expect(doc).toBe("Text before a\nbhere.");
    expect(doc.slice(caret)).toBe("here.");
  });

  it("joins a heading pasted mid-line to the line, without its #", () => {
    expect(paste("Text before here.", "here", "# Title\nbody").doc).toBe(
      "Text before Title\nbodyhere.",
    );
  });

  it("keeps a pasted heading at the start of a paragraph", () => {
    expect(paste("Text here", "Text", "# Title\nbody\n").doc).toBe("# Title\nbody\nText here");
  });

  it("gives a pasted code fence lines of its own", () => {
    expect(paste("Text before here.", "here", "intro\n```js\ncode\n```").doc).toBe(
      "Text before intro\n```js\ncode\n```\nhere.",
    );
    expect(paste("See **bold text** end", "text", "x\n```\ny\n```\nz").doc).toBe(
      "See **bold x**\n```\ny\n```\n**ztext** end",
    );
  });

  it("moves a word after bold ending in punctuation past it", () => {
    expect(paste("Ends **in bold.**", "", "word\nmore").doc).toBe("Ends **in bold**.word\nmore");
  });

  it("goes after a link or code it lands inside", () => {
    expect(paste("See [the guide](u) now.", "guide", "a\nb").doc).toBe(
      "See [the guide](u)a\nb now.",
    );
    expect(paste("We `code here` ok", "here", "a\nb").doc).toBe("We `code here`a\nb ok");
  });

  it("continues a list, a numbered list and a task list, as Enter does", () => {
    expect(paste("- item one two", "two", "a\nb\nc").doc).toBe("- item one a\n- b\n- ctwo");
    expect(paste("1. first second", "second", "a\nb\nc").doc).toBe("1. first a\n2. b\n3. csecond");
    expect(paste("- [x] done task", "task", "a\nb").doc).toBe("- [x] done a\n- [ ] btask");
  });

  it("keeps pasted list items in a quote", () => {
    expect(paste("> quoted words here", "words", "a\n- b\nc").doc).toBe(
      "> quoted a\n> - b\n> cwords here",
    );
  });

  it("splits a heading in two, and ends one with a paragraph", () => {
    expect(paste("## Heading split", "split", "a\nb").doc).toBe("## Heading a\n## bsplit");
    expect(paste("## Heading end", "", "a\nb").doc).toBe("## Heading enda\nb");
  });

  it("replaces a selection half inside bold", () => {
    const doc = "We want to see **which named readers** opened it.";
    expect(paste(doc, "see", "a\nb", "see **which".length).doc).toBe(
      "We want to a\nb **named readers** opened it.",
    );
  });

  it("leaves code blocks alone", () => {
    expect(paste("```\ncode line\n```", "line", "a\nb").doc).toBe("```\ncode a\nbline\n```");
  });
});
