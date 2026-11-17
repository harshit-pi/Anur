import { describe, expect, it } from "vitest";
import { cloudProviderOf } from "./cloud.ts";
import { findConflictCopies } from "./conflict-copies.ts";
import { applyMerge, planConflictMerge } from "./conflict-merge.ts";

const HOME = "/Users/sam";

describe("cloud folders", () => {
  it.each([
    [`${HOME}/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault`, "icloud"],
    [`${HOME}/Library/Mobile Documents/com~apple~CloudDocs/Notes`, "icloud"],
    [`${HOME}/Dropbox/Notes`, "dropbox"],
    [`${HOME}/Library/CloudStorage/Dropbox/Notes`, "dropbox"],
    [`${HOME}/Library/CloudStorage/OneDrive-Personal/Notes`, "onedrive"],
    [`${HOME}/Library/CloudStorage/GoogleDrive-sam@example.com/My Drive`, "google-drive"],
    [`${HOME}/Library/CloudStorage/Box-Box/Notes`, "cloud"],
    [`${HOME}/workspace/Anur`, null],
    [`${HOME}/DropboxOld/Notes`, null],
  ])("%s is %s", (p, want) => {
    expect(cloudProviderOf(p, HOME)).toBe(want);
  });
});

describe("conflict copies", () => {
  const docs = [
    "Notes.md",
    "Notes 2.md",
    "plans/Retry.md",
    "plans/Retry (Sam's conflicted copy 2026-11-17).md",
    "Plan 2.md",
    "Solo (conflicted copy 2026-11-17).md",
  ];

  it("finds iCloud's numbered copies only in iCloud, and Dropbox's anywhere", () => {
    expect(findConflictCopies(docs, "icloud")).toEqual([
      { original: "Notes.md", copy: "Notes 2.md", service: "icloud" },
      {
        original: "plans/Retry.md",
        copy: "plans/Retry (Sam's conflicted copy 2026-11-17).md",
        service: "dropbox",
      },
    ]);
    expect(findConflictCopies(docs, null)).toEqual([
      {
        original: "plans/Retry.md",
        copy: "plans/Retry (Sam's conflicted copy 2026-11-17).md",
        service: "dropbox",
      },
    ]);
  });

  it("needs the original beside the copy", () => {
    expect(findConflictCopies(["Plan 2.md"], "icloud")).toEqual([]);
  });
});

const ORIGINAL =
  "---\ntags: [a]\n---\n# Retry\n\n## Timing\n\nOne hour.\n\n## Channel\n\nEmail.\n\n## Old\n\nWeekly digest was dropped.\n";
const COPY =
  "---\ntags: [b]\n---\n# Retry\n\n## Timing\n\nThirty minutes.\n\n## Channel\n\nEmail.\n\n## New\n\nPush alerts arrive at once.\n";

describe("merging a conflict copy", () => {
  it("pairs sections and sorts them into same, differs and one-sided", () => {
    const plan = planConflictMerge(ORIGINAL, COPY);
    expect(plan.prefix).toBe("---\ntags: [a]\n---\n");
    expect(plan.parts.map((p) => [p.kind, p.path.at(-1)])).toEqual([
      ["same", "Retry"],
      ["differs", "Timing"],
      ["same", "Channel"],
      ["only-copy", "New"],
      ["only-original", "Old"],
    ]);
  });

  it("keeps the original by default, and the copy where picked", () => {
    const plan = planConflictMerge(ORIGINAL, COPY);
    const kept = applyMerge(plan);
    expect(kept).toContain("One hour.");
    expect(kept).toContain("Push alerts arrive at once.");
    expect(kept).toContain("Weekly digest was dropped.");
    const picked = applyMerge(plan, { 1: "copy", 4: false });
    expect(picked).toContain("Thirty minutes.");
    expect(picked).not.toContain("One hour.");
    expect(picked).not.toContain("Weekly digest was dropped.");
    expect(picked.startsWith("---\ntags: [a]\n---\n# Retry")).toBe(true);
  });

  it("gives back the original when the copy is the same", () => {
    expect(applyMerge(planConflictMerge(ORIGINAL, ORIGINAL))).toBe(ORIGINAL);
  });

  it("never runs two sections together when one ended the file with no newline", () => {
    const merged = applyMerge(
      planConflictMerge("# T\n\n## A\n\nend", "# T\n\n## A\n\nend\n\n## B\n\nnew\n"),
    );
    expect(merged).toBe("# T\n\n## A\n\nend\n\n## B\n\nnew\n");
  });
});
