import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchSections, sectionHitsText } from "./section-search.ts";

function folder() {
  const root = mkdtempSync(path.join(tmpdir(), "anur-sections-"));
  mkdirSync(path.join(root, "notes"));
  writeFileSync(
    path.join(root, "Plan.md"),
    "# Plan\n\nThe launch.\n\n## Retry timing\n\nEach retry waits 30 seconds.\nThen they back off.\n\n### Limits\n\nAt most five, and retry timing doubles.\n\n## Pricing\n\nNo retry here, but timing matters.\n",
  );
  writeFileSync(
    path.join(root, "notes", "Ops.md"),
    "# Ops\n\n## Pager\n\nRetry the page after timing out.\n",
  );
  writeFileSync(path.join(root, "Cloud.md"), "# Cloud\n\nRetry timing in the cloud.\n");
  return { path: root, docs: ["Plan.md", "notes/Ops.md", "Cloud.md"], offloaded: ["Cloud.md"] };
}

describe("anur_search_sections", () => {
  it("finds the sections whose own text has every word, with the matching lines", async () => {
    const found = await searchSections(folder(), "retry timing");
    expect(found.hits.map((h) => [h.doc, h.path.join(" > ")])).toEqual([
      ["Plan.md", "Plan > Retry timing"],
      // A subsection is a section of its own, found on its own words.
      ["Plan.md", "Plan > Retry timing > Limits"],
      ["Plan.md", "Plan > Pricing"],
      ["notes/Ops.md", "Ops > Pager"],
    ]);
    expect(found.hits[0]?.lines).toEqual([
      { line: 5, text: "## Retry timing" },
      { line: 7, text: "Each retry waits 30 seconds." },
    ]);
    expect(found.skipped).toBe(1);
  });

  it("leaves out docs still in iCloud, and says so", async () => {
    const found = await searchSections(folder(), "cloud");
    expect(found.hits).toEqual([]);
    expect(sectionHitsText("cloud", found)).toBe(
      'No section has every word of "cloud". 1 docs still in iCloud weren\'t searched.',
    );
  });

  it("answers with doc and heading path, then each line", async () => {
    const text = sectionHitsText("pager", await searchSections(folder(), "pager"));
    expect(text).toContain("- notes/Ops.md > Ops > Pager\n  3: ## Pager");
  });
});
