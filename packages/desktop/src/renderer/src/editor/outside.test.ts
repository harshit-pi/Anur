import { describe, expect, it } from "vitest";
import { diffSpan, mergeOutside } from "./outside.ts";

const BASE = "# Plan\n\nIntro line.\n\n## Retry\n\nThree tries.\n";

describe("a change made outside Anur", () => {
  it("is taken as is when nothing is unsaved", () => {
    const theirs = BASE.replace("Three", "Four");
    expect(mergeOutside(BASE, BASE, theirs)).toEqual({ text: theirs, clash: false });
  });

  it("keeps unsaved typing elsewhere in the doc", () => {
    const mine = BASE.replace("Intro line.", "Intro line, edited.");
    const theirs = BASE.replace("Three", "Four");
    expect(mergeOutside(BASE, mine, theirs)).toEqual({
      text: BASE.replace("Intro line.", "Intro line, edited.").replace("Three", "Four"),
      clash: false,
    });
  });

  it("takes the file's version when unsaved typing overlaps it", () => {
    const mine = BASE.replace("Three tries.", "Three tries, mine.");
    const theirs = BASE.replace("Three tries.", "Five tries.");
    expect(mergeOutside(BASE, mine, theirs)).toEqual({ text: theirs, clash: true });
  });

  it("is no clash when both made the same change", () => {
    const same = BASE.replace("Three", "Four");
    expect(mergeOutside(BASE, same, same)).toEqual({ text: same, clash: false });
  });
});

describe("the span between two texts", () => {
  it("covers only what differs", () => {
    expect(diffSpan("abcdef", "abXYef")).toEqual({ from: 2, to: 4, insert: "XY" });
    expect(diffSpan("same", "same")).toBeNull();
    expect(diffSpan("ab", "abc")).toEqual({ from: 2, to: 2, insert: "c" });
  });
});
