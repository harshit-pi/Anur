import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { linkTarget } from "./link-editor.ts";
import { markdownSupport } from "./sections.ts";

const state = (doc: string) => EditorState.create({ doc, extensions: [markdownSupport()] });

describe("a link's address", () => {
  it("is found from anywhere in the link's text", () => {
    const doc = "See [the plan](https://x.com/plan) now";
    const t = linkTarget(state(doc), doc.indexOf("plan"));
    expect(t?.kind).toBe("link");
    expect(doc.slice(t?.value.from, t?.value.to)).toBe("https://x.com/plan");
  });

  it("goes between the parentheses of a new link", () => {
    const doc = "See [the plan]() now";
    const t = linkTarget(state(doc), doc.indexOf("plan"));
    expect(t?.value).toEqual({ from: doc.indexOf("()") + 1, to: doc.indexOf("()") + 1 });
  });

  it("is the doc and heading of a wiki link, not its alias", () => {
    const doc = "Read [[Design#Editor|§ Editor]] first";
    const t = linkTarget(state(doc), doc.indexOf("§"));
    expect(t?.kind).toBe("wiki");
    expect(doc.slice(t?.value.from, t?.value.to)).toBe("Design#Editor");
  });

  it("is nothing outside a link", () => {
    expect(linkTarget(state("plain text"), 3)).toBeNull();
  });
});
