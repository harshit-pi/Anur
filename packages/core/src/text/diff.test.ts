import { describe, expect, it } from "vitest";
import { applyHunks, diffLines, merge3, splitLines } from "./diff.ts";

const L = (s: string) => splitLines(s);

describe("splitLines", () => {
  it("keeps each line's ending, so joining gives the text back", () => {
    for (const s of ["", "a", "a\n", "a\nb", "a\r\nb\r\n", "\n\n"]) expect(L(s).join("")).toBe(s);
  });
});

describe("diffLines", () => {
  it("finds the changed lines and nothing else", () => {
    expect(diffLines(L("a\nb\nc\n"), L("a\nB\nc\n"))).toEqual([
      { aFrom: 1, aTo: 2, bFrom: 1, bTo: 2 },
    ]);
    expect(diffLines(L("a\nc\n"), L("a\nb\nc\n"))).toEqual([
      { aFrom: 1, aTo: 1, bFrom: 1, bTo: 2 },
    ]);
    expect(diffLines(L("a\nb\nc\n"), L("a\nc\n"))).toEqual([
      { aFrom: 1, aTo: 2, bFrom: 1, bTo: 1 },
    ]);
    expect(diffLines(L("same\n"), L("same\n"))).toEqual([]);
  });

  it("keeps separate edits separate", () => {
    const a = L("1\n2\n3\n4\n5\n6\n");
    const b = L("1\nTWO\n3\n4\nFIVE\n6\n");
    expect(diffLines(a, b)).toEqual([
      { aFrom: 1, aTo: 2, bFrom: 1, bTo: 2 },
      { aFrom: 4, aTo: 5, bFrom: 4, bTo: 5 },
    ]);
  });

  it("rebuilds the new text from all its hunks, and keeps the old where hunks are left out", () => {
    const a = L("x\na\nb\nc\nd\ny\n");
    const b = L("a\nB\nc\nD\nE\nz\n");
    const hunks = diffLines(a, b);
    expect(applyHunks(a, b, hunks)).toBe(b.join(""));
    expect(applyHunks(a, b, [])).toBe(a.join(""));
  });
});

describe("merge3", () => {
  const base = "intro\n\nRetry after 1, 3 and 7 days.\n\nEmail the client.\n";

  it("takes each side's change where they don't overlap", () => {
    const ours = base.replace("intro", "Intro, edited by hand");
    const theirs = base.replace("Email the client.", "Email the client within an hour.");
    expect(merge3(base, ours, theirs)).toEqual({
      text: "Intro, edited by hand\n\nRetry after 1, 3 and 7 days.\n\nEmail the client within an hour.\n",
      conflicts: 0,
    });
  });

  it("counts a stretch both sides changed differently, and keeps the side preferred", () => {
    const ours = base.replace("1, 3 and 7", "2, 4 and 8");
    const theirs = base.replace("1, 3 and 7", "the pay day + 1");
    const kept = merge3(base, ours, theirs);
    expect(kept.conflicts).toBe(1);
    expect(kept.text).toContain("2, 4 and 8");
    expect(merge3(base, ours, theirs, "theirs").text).toContain("the pay day + 1");
  });

  it("agrees when both sides made the same change", () => {
    const both = base.replace("intro", "Intro");
    expect(merge3(base, both, both)).toEqual({ text: both, conflicts: 0 });
  });

  it("keeps two insertions in different places", () => {
    const ours = `${base}Added at the end.\n`;
    const theirs = `New first line.\n${base}`;
    expect(merge3(base, ours, theirs)).toEqual({
      text: `New first line.\n${base}Added at the end.\n`,
      conflicts: 0,
    });
  });
});

describe("diffLines on random texts", () => {
  it("always rebuilds the new text, with hunks in order and the lines between them equal", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const words = ["a\n", "b\n", "c\n", "d\n", "\n"];
    const random = () => Array.from({ length: rand(12) }, () => words[rand(words.length)] ?? "");
    for (let i = 0; i < 2000; i++) {
      const a = random();
      const b = random();
      const hunks = diffLines(a, b);
      expect(applyHunks(a, b, hunks)).toBe(b.join(""));
      let ax = 0;
      let by = 0;
      for (const h of hunks) {
        expect(h.aFrom).toBeGreaterThanOrEqual(ax);
        expect(a.slice(ax, h.aFrom)).toEqual(b.slice(by, h.bFrom));
        ax = h.aTo;
        by = h.bTo;
      }
      expect(a.slice(ax)).toEqual(b.slice(by));
      // Merging one side's edit onto an untouched other side gives that edit.
      expect(merge3(a.join(""), a.join(""), b.join("")).text).toBe(b.join(""));
    }
  });
});
