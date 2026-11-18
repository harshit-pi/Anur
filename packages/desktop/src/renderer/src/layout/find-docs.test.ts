import { describe, expect, it } from "vitest";
import { findDocs } from "./find-docs.ts";

const DOCS = [
  "Job Search/Companies/Assort Health.md",
  "Interview Prep/Companies/Assort Health/Assort Health - What They Ask.md",
  "Interview Prep/Companies/Assort Health/Assort Health Onsite - Prep.md",
  "Interview Prep/Design Bank/Assort Design 4 - Flight Search.md",
  "Notes/Health insurance.md",
  ...Array.from(
    { length: 30 },
    (_, i) => `Interview Prep/Companies/Assort Health/Round ${String(i)}.md`,
  ),
];

describe("findDocs", () => {
  it("takes the words in any order, in the name or the folder path", () => {
    expect(findDocs(DOCS, "health assort")[0]).toBe("Job Search/Companies/Assort Health.md");
    expect(findDocs(DOCS, "assort onsite")).toEqual([
      "Interview Prep/Companies/Assort Health/Assort Health Onsite - Prep.md",
    ]);
    // "design bank" is only in the folder path.
    expect(findDocs(DOCS, "design bank flight")).toEqual([
      "Interview Prep/Design Bank/Assort Design 4 - Flight Search.md",
    ]);
  });

  it("has no cap: every match is listed", () => {
    expect(findDocs(DOCS, "assort health").length).toBe(33);
  });

  it("puts the exact name first, then recent docs above others like them", () => {
    const recent = ["Interview Prep/Companies/Assort Health/Round 7.md"];
    const found = findDocs(DOCS, "round", recent);
    expect(found[0]).toBe("Interview Prep/Companies/Assort Health/Round 7.md");
    expect(findDocs(DOCS, "assort health")[0]).toBe("Job Search/Companies/Assort Health.md");
  });
});
