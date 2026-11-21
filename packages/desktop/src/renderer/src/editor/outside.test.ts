import { describe, expect, it } from "vitest";
import { changeWithin, diffSpan, mergeOutside, putBack } from "./outside.ts";

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
    const r = mergeOutside(BASE, mine, theirs);
    expect(r.text).toBe(theirs);
    expect(r.clash).toBe(true);
    expect(r.kept?.mine).toBe("Three tries, mine.");
    expect(r.kept?.theirs).toBe("Five tries.");
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

describe("putting kept typing back", () => {
  it("replaces the file's version of the lines with the person's", () => {
    const mine = BASE.replace("Three tries.", "Three tries, mine.");
    const theirs = BASE.replace("Three tries.", "Five tries.");
    const { kept } = mergeOutside(BASE, mine, theirs);
    if (!kept) throw new Error("expected a clash");
    const span = putBack(theirs, kept);
    expect(span && theirs.slice(0, span.from) + span.insert + theirs.slice(span.to)).toBe(mine);
  });

  it("finds the place by its surroundings when the lines appear twice", () => {
    const base = "## A\n\nSame.\n\n## B\n\nSame.\n";
    const mine = base.replace("## B\n\nSame.", "## B\n\nMine.");
    const theirs = base.replace("## B\n\nSame.", "## B\n\nTheirs.");
    const { kept } = mergeOutside(base, mine, theirs);
    if (!kept) throw new Error("expected a clash");
    const doc = theirs.replace("## A\n\nSame.", "## A\n\nTheirs.");
    const span = putBack(doc, kept);
    expect(span && doc.slice(0, span.from) + span.insert + doc.slice(span.to)).toBe(
      "## A\n\nTheirs.\n\n## B\n\nMine.\n",
    );
  });

  it("gives up when the file's version is gone", () => {
    expect(
      putBack("Something else.", { mine: "a", theirs: "b", before: "", after: "" }),
    ).toBeNull();
  });
});

describe("changeWithin", () => {
  it("replaces only the middle, offset into the page", () => {
    const section = "# A\n1\nBuilt\n2\n3\n";
    const moved = "# A\n1\n2\n3\nBuilt\n";
    const c = changeWithin(100, section, moved);
    expect(c).toEqual({ from: 106, to: 115, insert: "2\n3\nBuilt" });
    if (!c) throw new Error("no change");
    expect(section.slice(0, c.from - 100) + c.insert + section.slice(c.to - 100)).toBe(moved);
  });
  it("is null when nothing differs", () => {
    expect(changeWithin(5, "same", "same")).toBeNull();
  });
});
