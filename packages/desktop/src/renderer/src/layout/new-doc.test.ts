import { describe, expect, it } from "vitest";
import { docsNamed, newDocPath } from "./new-doc.ts";

describe("a new doc", () => {
  it("goes beside the open doc, named as typed or Untitled", () => {
    expect(newDocPath([], "Ideas/Gift.md", "Launch plan")).toBe("Ideas/Launch plan.md");
    expect(newDocPath([], null)).toBe("Untitled.md");
  });

  it("gets a number when the name is taken, case ignored", () => {
    expect(newDocPath(["untitled.md", "Untitled 2.md"], null)).toBe("Untitled 3.md");
  });

  it("drops characters a file name or a wiki link can't hold", () => {
    expect(newDocPath([], null, "Q3: plan/v2 #draft")).toBe("Q3 plan v2 draft.md");
    expect(newDocPath([], null, "...")).toBe("Untitled.md");
  });
});

describe("docs found by name", () => {
  it("puts names starting with the query first, then the shortest", () => {
    const docs = ["Ideas/Meeting notes.md", "Notes.md", "Plan.md", "Archive/Old notes.md"];
    expect(docsNamed(docs, "notes")).toEqual([
      "Notes.md",
      "Archive/Old notes.md",
      "Ideas/Meeting notes.md",
    ]);
  });
});
