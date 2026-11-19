import { describe, expect, it } from "vitest";
import { buildSectionTree } from "../index.ts";
import { withCreatedProperties } from "./created-properties.ts";

const p = { owner: "harshit-pi", created: "2026-11-19" };

describe("the properties of a doc Anur creates", () => {
  it("puts owner and created above a new doc, which still reads as the same sections", () => {
    const text = withCreatedProperties("# Plan\n\n## Risks\n", p);
    expect(text).toBe("---\nowner: [harshit-pi]\ncreated: 2026-11-19\n---\n\n# Plan\n\n## Risks\n");
    expect(
      buildSectionTree(text, { fileName: "plan.md" }).sections.map((s) => s.path.at(-1)),
    ).toEqual(["Plan", "Risks"]);
  });

  it("adds only the keys a doc's own properties lack, keeping the rest as written", () => {
    const text = "---\ntags: [a, b]\nowner: [priya]\n---\n\n# Plan\n";
    expect(withCreatedProperties(text, p)).toBe(
      "---\ntags: [a, b]\nowner: [priya]\ncreated: 2026-11-19\n---\n\n# Plan\n",
    );
    const full = "---\nowner: [priya]\ncreated: 2026-01-01\n---\n# Plan\n";
    expect(withCreatedProperties(full, p)).toBe(full);
  });

  it("quotes a name YAML would misread", () => {
    expect(withCreatedProperties("# A\n", { owner: "Sam: lead", created: "2026-11-19" })).toContain(
      'owner: ["Sam: lead"]',
    );
  });
});
