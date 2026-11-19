import { describe, expect, it } from "vitest";
import { retitled } from "./title-follows.ts";

describe("a title following its file name", () => {
  it("renames a title that matched the old name", () => {
    expect(retitled("# Untitled\n\nText.\n", "a/Untitled.md", "a/GTM Strategy.md")).toBe(
      "# GTM Strategy\n\nText.\n",
    );
  });

  it("reads past front matter and blank lines", () => {
    expect(retitled("---\ntags: x\n---\n\n# Old\n", "Old.md", "New.md")).toBe(
      "---\ntags: x\n---\n\n# New\n",
    );
  });

  it("leaves a title written apart from the file name", () => {
    expect(retitled("# Referral launch plan\n", "Plan.md", "Referral.md")).toBeNull();
  });

  it("does nothing when only the folder changed", () => {
    expect(retitled("# Plan\n", "a/Plan.md", "b/Plan.md")).toBeNull();
  });

  it("does nothing for a doc with no title", () => {
    expect(retitled("Some text\n# Old\n", "Old.md", "New.md")).toBeNull();
  });
});
