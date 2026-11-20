import { describe, expect, it } from "vitest";
import { containsLines, decideConflict } from "./conflict-resolve.ts";

const doc = (a: string, b: string) => `# Plan\n\n## Launch\n\n${a}\n\n## Price\n\n${b}\n`;

describe("a conflict copy, settled without asking", () => {
  it("drops a copy that's the same, line endings and trailing spaces aside", () => {
    expect(
      decideConflict(doc("March.", "Five."), doc("March.  ", "Five.").replace(/\n/g, "\r\n")).kind,
    ).toBe("same");
  });

  it("keeps the fuller one when a device only added", () => {
    const more = decideConflict(doc("March.", "Five."), doc("March.\nInvite first.", "Five."));
    expect(more).toMatchObject({ kind: "write", text: doc("March.\nInvite first.", "Five.") });
    expect(decideConflict(doc("March.\nInvite first.", "Five."), doc("March.", "Five.")).kind).toBe(
      "keep-original",
    );
  });

  it("merges sections changed on one side each, using history to know which is older", () => {
    const original = doc("April.", "Five.");
    const copy = doc("March.", "Six.");
    // History says Launch once read "March." (so April is newer) and Price "Five." (so Six is newer).
    const known = (p: string[]) =>
      p.at(-1) === "Launch" ? ["## Launch\n\nMarch.\n\n"] : ["## Price\n\nFive.\n"];
    expect(decideConflict(original, copy, known)).toMatchObject({
      kind: "write",
      text: doc("April.", "Six."),
    });
  });

  it("keeps both when a section changed differently on both sides, or the notes are different", () => {
    expect(decideConflict(doc("April.", "Five."), doc("May.", "Five.")).kind).toBe("keep-both");
    const other =
      "# Things I would tell my younger self\n\nHello, I want to talk about a couple of things.\n";
    const list = "# Things I would tell my younger self\n\n**1) Don't chase friendships.**\n";
    expect(decideConflict(list, other).kind).toBe("keep-both");
  });

  it("reads containment line by line, in order", () => {
    expect(containsLines("a\nb\nc", "a\nc")).toBe(true);
    expect(containsLines("a\nb\nc", "c\na")).toBe(false);
  });
});
