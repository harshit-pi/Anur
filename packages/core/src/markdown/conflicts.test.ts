import { describe, expect, it } from "vitest";
import { buildSectionTree } from "../sections/index.ts";
import { conflictsIn, resolution } from "./conflicts.ts";
import { markdownParser } from "./index.ts";

const DOC = [
  "# Plan",
  "",
  "<<<<<<< HEAD",
  "Ship on Monday.",
  "=======",
  "Ship on Friday.",
  ">>>>>>> theirs",
  "",
  "## Risks",
  "",
].join("\n");

const names = (text: string) => {
  const out: string[] = [];
  markdownParser.parse(text).iterate({
    enter(n) {
      if (n.name !== "Document" && n.name !== "Paragraph") out.push(n.name);
    },
  });
  return out;
};

describe("merge-conflict markers", () => {
  it("read as markers, never as a heading or a quote", () => {
    const found = names(DOC);
    expect(found.filter((n) => n === "ConflictMarker")).toHaveLength(3);
    expect(found).not.toContain("SetextHeading1");
    expect(found).not.toContain("Blockquote");
  });

  it("add no sections to the outline", () => {
    const paths = buildSectionTree(DOC, { fileName: "Plan.md" }).sections.map((s) =>
      s.path.join(" > "),
    );
    expect(paths).toEqual(["Plan", "Plan > Risks"]);
  });

  it("leave a heading underlined with seven = alone in a doc with no conflict", () => {
    expect(names("Title\n=======\n\ntext")).toContain("SetextHeading1");
  });

  it("are found with each side, and resolve to either or both", () => {
    const [c] = conflictsIn(DOC);
    expect(c).toMatchObject({
      ours: "Ship on Monday.",
      theirs: "Ship on Friday.",
      oursLabel: "HEAD",
      theirsLabel: "theirs",
    });
    if (!c) throw new Error("no conflict");
    expect(DOC.slice(c.from, c.to).split("\n")).toHaveLength(5);
    expect(resolution(c, "both")).toBe("Ship on Monday.\nShip on Friday.");
  });

  it("skip the original side of a three-way conflict", () => {
    const [c] = conflictsIn("<<<<<<< ours\na\n||||||| base\nold\n=======\nb\n>>>>>>> theirs");
    expect(c?.ours).toBe("a");
    expect(c?.theirs).toBe("b");
  });
});
