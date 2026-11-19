import { describe, expect, it } from "vitest";
import { decisionWordingProblem, scopeFromWords } from "./wording.ts";

describe("how a decision reads (2026-11-19 review)", () => {
  it("takes a short statement of one idea", () => {
    expect(decisionWordingProblem("Three retries, not infinite.")).toBeNull();
    expect(decisionWordingProblem("Task lists stay in this doc.")).toBeNull();
    expect(decisionWordingProblem("Drafts allowed, never sent.")).toBeNull();
  });

  it("refuses one too long, two ideas, someone's voice, or an order", () => {
    expect(
      decisionWordingProblem("Keep task lists in this doc and create nothing in Linear or Gmail."),
    ).toMatch(/at most 7 words/);
    expect(decisionWordingProblem("Drafts allowed; never sent.")).toMatch(/two ideas/);
    expect(decisionWordingProblem("We retry three times.")).toMatch(/someone's voice/);
    expect(decisionWordingProblem("Don't touch the code.")).toMatch(/order/);
  });
});

describe("how far a decision reaches", () => {
  it("never reaches wider than the person's words", () => {
    // The churn run: "for this launch or later" isn't the whole folder.
    expect(
      scopeFromWords(
        "Don't touch any code repos and don't deploy anything, for this launch or later.",
        "folder",
        "work",
      ),
    ).toBe("doc");
    expect(scopeFromWords("Same for every doc in this folder.", "folder", undefined)).toBe(
      "folder",
    );
    expect(scopeFromWords("Always three retries.", "everywhere", undefined)).toBe("everywhere");
    expect(scopeFromWords("Three retries.", "everywhere", undefined)).toBe("doc");
  });

  it("holds a rule about the work for its doc, and a subject for its section, when unscoped", () => {
    expect(scopeFromWords("No Linear for this.", undefined, "work")).toBe("doc");
    expect(scopeFromWords("Three retries.", undefined, undefined)).toBe("section");
    expect(scopeFromWords("Three retries.", "doc", undefined)).toBe("doc");
  });
});
