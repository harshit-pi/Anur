import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "../sections.ts";
import { calloutKindRange, embedPathRange, fenceInfoRange, languageName } from "./chips.ts";

const state = (doc: string) => EditorState.create({ doc, extensions: [markdownSupport()] });
const slice = (doc: string, r: { from: number; to: number } | null) =>
  r ? doc.slice(r.from, r.to) : null;

describe("what a chip changes", () => {
  it("a callout's type", () => {
    const doc = "> [!warning] Careful";
    const r = calloutKindRange(state(doc), doc.indexOf("[!"));
    expect(slice(doc, r)).toBe("warning");
  });

  it("a code block's language, or where it goes when there is none", () => {
    const doc = "```ts\nlet a;\n```";
    expect(slice(doc, fenceInfoRange(state(doc), 0))).toBe("ts");
    const bare = "```\nx\n```";
    expect(fenceInfoRange(state(bare), 0)).toEqual({ from: 3, to: 3, info: "" });
  });

  it("an image's or embed's path", () => {
    const img = "See ![chart](charts/q3.png) here";
    expect(slice(img, embedPathRange(state(img), img.indexOf("!")))).toBe("charts/q3.png");
    const embed = "![[Mocks/Flow.png]]";
    expect(slice(embed, embedPathRange(state(embed), 0))).toBe("Mocks/Flow.png");
  });

  it("names languages as people know them", () => {
    expect(languageName("ts")).toBe("TypeScript");
    expect(languageName("")).toBe("Plain text");
    expect(languageName("elixir")).toBe("elixir");
  });
});
