import { describe, expect, it } from "vitest";
import { buildSectionTree } from "../sections/tree.ts";
import { buildBundle } from "./bundle.ts";

const DOC = `# Failed-payment notifications

Tell the client within an hour; retry on a schedule.

## Problem

1 in 25 card payments fails first try.

## Retry timing

Retry after 1, 3 and 7 days.

### Pay day

Use the client's pay day.

## Success metric

- Recovered revenue per month.
`;

const tree = buildSectionTree(DOC, { fileName: "notes.md" });
const at = (name: string) => tree.sections.findIndex((s) => s.path.at(-1) === name);

describe("buildBundle", () => {
  it("sends the parent's own text, the section's subtree and the siblings' outline", () => {
    const b = buildBundle({ text: DOC, tree, index: at("Retry timing"), docPath: "notes.md" });
    expect(b.parts.map((p) => [p.kind, p.label, p.detail])).toEqual([
      ["ancestor", "Failed-payment notifications", "parent, its text"],
      ["section", "Retry timing", "this section, its text"],
      ["siblings", "Sibling sections", "their outline"],
    ]);
    expect(b.parts[0]?.text).toBe("Tell the client within an hour; retry on a schedule.");
    expect(b.parts[1]?.text).toContain("### Pay day");
    expect(b.parts[2]?.text).toBe(
      "- Problem: 1 in 25 card payments fails first try.\n- Success metric: Recovered revenue per month.",
    );
  });

  it("never carries a sibling's full text", () => {
    const b = buildBundle({ text: DOC, tree, index: at("Problem"), docPath: "notes.md" });
    expect(b.markdown).not.toContain("Use the client's pay day.");
    expect(b.markdown).toContain("Retry timing: Retry after 1, 3 and 7 days.");
  });

  it("gives every ancestor its own text only, for a deeper section", () => {
    const b = buildBundle({ text: DOC, tree, index: at("Pay day"), docPath: "notes.md" });
    expect(b.parts.filter((p) => p.kind === "ancestor").map((p) => p.detail)).toEqual([
      "above, its text",
      "parent, its text",
    ]);
    expect(b.parts[1]?.text).toBe("Retry after 1, 3 and 7 days.");
    expect(b.markdown).not.toContain("1 in 25");
  });

  it("follows the rules it is given, so a variant is configuration", () => {
    const b = buildBundle({
      text: DOC,
      tree,
      index: at("Retry timing"),
      docPath: "notes.md",
      rules: ["section-subtree"],
    });
    expect(b.parts.map((p) => p.kind)).toEqual(["section"]);
  });

  it("names the thread's working copy, when it has one", () => {
    const b = buildBundle({
      text: DOC,
      tree,
      index: at("Problem"),
      docPath: "notes.md",
      workingCopy: "/copies/t1/notes.md",
    });
    expect(b.markdown).toContain("Your working copy of `notes.md` is at `/copies/t1/notes.md`.");
  });

  it("names the doc and the section in its header", () => {
    const b = buildBundle({ text: DOC, tree, index: 0, docPath: "notes.md" });
    expect(b.markdown).toContain("`notes.md`: **Failed-payment notifications**");
    expect(b.parts.map((p) => p.kind)).toEqual(["section"]);
  });
});
