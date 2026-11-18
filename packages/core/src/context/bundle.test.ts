import { describe, expect, it } from "vitest";
import { buildSectionTree } from "../sections/tree.ts";
import { buildBundle, budgetFor, embedTargets, expandEmbeds, FULL_TEXT_BUDGET } from "./bundle.ts";

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

/** The outline, as the default falls back to past the budget. */
const OUTLINE = ["ancestors-own-text", "section-subtree", "doc-outline"] as const;

describe("buildBundle", () => {
  it("sends, by default, the rest of the doc in full within the budget", () => {
    const b = buildBundle({ text: DOC, tree, index: at("Problem"), docPath: "notes.md" });
    expect(b.parts.map((p) => [p.kind, p.detail])).toEqual([
      ["ancestor", "parent, its text"],
      ["section", "this section, its text"],
      ["full", "its text"],
    ]);
    expect(b.markdown).toContain("Fall back to day 1 for new clients.");
    expect(b.markdown).not.toContain("Before you answer, read with anur_read_section");
  });

  it("falls back, by default, to the outline and the hint to fetch past the budget", () => {
    const b = buildBundle({
      text: DOC,
      tree,
      index: at("Problem"),
      docPath: "notes.md",
      budget: 10,
    });
    expect(b.parts.at(-1)?.kind).toBe("outline");
    expect(b.markdown).toContain("Before you answer, read with anur_read_section");
  });

  it("sends the parent's own text, the section's subtree and the whole doc's outline", () => {
    const b = buildBundle({
      text: DOC,
      tree,
      index: at("Pay day"),
      docPath: "notes.md",
      rules: OUTLINE,
    });
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
    const b = buildBundle({
      text: DOC,
      tree,
      index: at("Problem"),
      docPath: "notes.md",
      rules: OUTLINE,
    });
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
    const b = buildBundle({
      text: DOC,
      tree,
      index: at("Problem"),
      docPath: "notes.md",
      rules: OUTLINE,
    });
    expect(b.markdown).not.toContain("Fall back to day 1");
    expect(b.markdown).toContain("Retry timing: Retry after 1, 3 and 7 days.");
  });

  it("gives every ancestor its own text only, for a deeper section", () => {
    const b = buildBundle({
      text: DOC,
      tree,
      index: at("Pay day"),
      docPath: "notes.md",
      rules: OUTLINE,
    });
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

describe("the budget, sized to the model's window (4.2)", () => {
  it("is a third of the window, at about four characters a token", () => {
    expect(budgetFor(1_000_000)).toBe(1_333_333);
    expect(budgetFor(200_000)).toBe(266_667);
  });

  it("is the 200,000-token default before the agent reports a window", () => {
    expect(budgetFor(null)).toBe(FULL_TEXT_BUDGET);
    expect(budgetFor(0)).toBe(FULL_TEXT_BUDGET);
  });
});

describe("inputs carried to a thread (4.4)", () => {
  it("are listed by name, untrusted ones marked, with how to read them", () => {
    const tree = buildSectionTree(DOC, { fileName: "doc.md" });
    const { markdown } = buildBundle({
      text: DOC,
      tree,
      index: 1,
      docPath: "doc.md",
      inputs: [
        { label: "notes/comp.txt", source: "file", trust: "trusted" },
        { label: "https://example.com", source: "fetch", trust: "untrusted" },
      ],
    });
    expect(markdown).toContain("## Inputs from earlier threads on this section or above it");
    expect(markdown).toContain("- file: notes/comp.txt\n");
    expect(markdown).toContain("- fetch: https://example.com (untrusted)");
    expect(markdown).toContain("anur_read_input");
  });

  it("add nothing when there are none", () => {
    const tree = buildSectionTree(DOC, { fileName: "doc.md" });
    expect(buildBundle({ text: DOC, tree, index: 1, docPath: "doc.md" }).markdown).not.toContain(
      "Inputs from earlier threads",
    );
  });
});

describe("an embedded base in the bundle (4.11)", () => {
  const doc = `# Plan\n\nIntro.\n\n## Ideas\n\n![[Ideas.base]]\n\n## Next\n\nLater.\n`;
  const table = "| Name | Score |\n| --- | --- |\n| Tally | 8 |";

  it("finds embed lines, with or without a view", () => {
    expect(
      embedTargets("a\n![[Ideas.base#Open]]\n![[pic.png|200]]\ntext ![[inline.base]] here"),
    ).toEqual(["Ideas.base#Open", "pic.png"]);
  });

  it("reaches the agent as its table, not as the embed line", () => {
    const tree = buildSectionTree(doc, { fileName: "doc.md" });
    const { markdown } = buildBundle({
      text: doc,
      tree,
      index: 1,
      docPath: "doc.md",
      embeds: new Map([["Ideas.base", table]]),
    });
    expect(markdown).toContain(table);
    expect(markdown).not.toContain("![[Ideas.base]]");
  });

  it("leaves an embed it has no text for as it is", () => {
    expect(expandEmbeds("![[Gone.base]]", new Map())).toBe("![[Gone.base]]");
  });
});

describe("linked sections (group 8)", () => {
  const text = "# Plan\n\n## Pricing\n\nSee [[Pricing#Plans]].\n";
  const tree = buildSectionTree(text, { fileName: "Plan.md" });
  it("brings each linked section's text, labelled with its file, and names broken links", () => {
    const b = buildBundle({
      text,
      tree,
      index: 1,
      docPath: "Plan.md",
      linked: [{ label: "Pricing.md › Plans", path: "Pricing.md", text: "Paid: £4." }],
      broken: ["Nowhere"],
    });
    expect(b.markdown).toContain("## Linked from this section: Pricing.md › Plans\n\nPaid: £4.");
    expect(b.markdown).toContain("- [[Nowhere]]");
    expect(b.parts.some((p) => p.kind === "linked")).toBe(true);
  });

  it("leaves out what doesn't fit the budget, naming it with its path", () => {
    const b = buildBundle({
      text,
      tree,
      index: 1,
      docPath: "Plan.md",
      budget: 200,
      linked: [
        { label: "A.md", path: "A.md", text: "a".repeat(50) },
        { label: "B.md", path: "notes/B.md", text: "b".repeat(500) },
      ],
    });
    expect(b.markdown).toContain("## Linked from this section: A.md");
    expect(b.markdown).toContain("## Linked, not included");
    expect(b.markdown).toContain("- B.md: `notes/B.md`");
    expect(b.markdown).not.toContain("bbbb");
  });
});

describe("findings (16.1)", () => {
  it("carries kept findings with their sources, and asks for new ones through the tool", () => {
    const text = "# Plan\n\n## Pricing\n\nSplitwise is £5.\n";
    const b = buildBundle({
      text,
      tree: buildSectionTree(text, { fileName: "Plan.md" }),
      index: 1,
      docPath: "Plan.md",
      findings: [
        { claim: "Splitwise Pro is £2.99 a month.", source: "competitors.txt", section: "Pricing" },
      ],
    });
    expect(b.markdown).toContain("## Findings kept on this section");
    expect(b.markdown).toContain(
      "- Splitwise Pro is £2.99 a month. (source: competitors.txt) [on Pricing]",
    );
    expect(b.markdown).toContain("anur_propose_finding");
  });
});
