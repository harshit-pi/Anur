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

Fall back to day 1 for new clients.

## Success metric

- Recovered revenue per month.
`;

const tree = buildSectionTree(DOC, { fileName: "notes.md" });
const at = (name: string) => tree.sections.findIndex((s) => s.path.at(-1) === name);

describe("buildBundle", () => {
  it("sends the parent's own text, the section's subtree and the whole doc's outline", () => {
    const b = buildBundle({ text: DOC, tree, index: at("Pay day"), docPath: "notes.md" });
    expect(b.parts.map((p) => [p.kind, p.label, p.detail])).toEqual([
      ["ancestor", "Failed-payment notifications", "above, its text"],
      ["ancestor", "Retry timing", "parent, its text"],
      ["section", "Pay day", "this section, its text"],
      ["outline", "The rest of the doc", "its outline"],
    ]);
    // Sections further away come in too, as their heading and first line.
    expect(b.parts[3]?.text).toBe(
      [
        "- Failed-payment notifications (the doc's title, its text given)",
        "  - Problem: 1 in 25 card payments fails first try.",
        "  - Retry timing (above it, its text given)",
        "    - **Pay day** (this section, given in full)",
        "  - Success metric: Recovered revenue per month.",
      ].join("\n"),
    );
  });

  it("keeps a sibling's full text out, and its subsections' own lines in the outline", () => {
    const b = buildBundle({ text: DOC, tree, index: at("Problem"), docPath: "notes.md" });
    expect(b.markdown).not.toContain("Fall back to day 1");
    expect(b.parts.at(-1)?.text).toContain("    - Pay day: Use the client's pay day.");
  });

  it("still offers the siblings-only outline as a variant", () => {
    const b = buildBundle({
      text: DOC,
      tree,
      index: at("Retry timing"),
      docPath: "notes.md",
      rules: ["ancestors-own-text", "section-subtree", "siblings-outline"],
    });
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
    expect(b.markdown).not.toContain("Fall back to day 1");
    expect(b.markdown).toContain("Retry timing: Retry after 1, 3 and 7 days.");
  });

  it("gives every ancestor its own text only, for a deeper section", () => {
    const b = buildBundle({ text: DOC, tree, index: at("Pay day"), docPath: "notes.md" });
    expect(b.parts.filter((p) => p.kind === "ancestor").map((p) => p.detail)).toEqual([
      "above, its text",
      "parent, its text",
    ]);
    expect(b.parts[1]?.text).toBe("Retry after 1, 3 and 7 days.");
    expect(b.markdown).not.toContain("## Problem");
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

describe("the full-text and fetch-hint variants", () => {
  it("doc-full sends every other section in full, and falls back to the outline past the budget", () => {
    const rules = ["ancestors-own-text", "section-subtree", "doc-full"] as const;
    const full = buildBundle({ text: DOC, tree, index: at("Problem"), docPath: "notes.md", rules });
    expect(full.parts.at(-1)?.kind).toBe("full");
    expect(full.markdown).toContain("Fall back to day 1 for new clients.");
    expect(full.markdown).toContain("the rest of the doc in full");
    const tight = buildBundle({
      text: DOC,
      tree,
      index: at("Problem"),
      docPath: "notes.md",
      rules,
      budget: 20,
    });
    expect(tight.parts.at(-1)?.kind).toBe("outline");
    expect(tight.markdown).not.toContain("Fall back to day 1");
  });

  it("fetch-hint asks the agent to read sections that could set a rule", () => {
    const b = buildBundle({
      text: DOC,
      tree,
      index: at("Problem"),
      docPath: "notes.md",
      rules: ["ancestors-own-text", "section-subtree", "doc-outline", "fetch-hint"],
    });
    expect(b.markdown).toContain("Before you answer, read with anur_read_section");
  });
});
