import { describe, expect, it } from "vitest";
import { actionPrompt } from "./actions";

describe("actionPrompt build", () => {
  it("tells the agent to update an earlier Build's doc before making a new one", () => {
    const prompt = actionPrompt("build", "Findings", "");
    expect(prompt).toContain("Look first for what an earlier Build of this section made");
    expect(prompt).toContain("update that doc instead of making a second");
    expect(prompt).toContain("only when there is no earlier one");
  });

  it("leaves Check read-only, with no earlier-doc rule", () => {
    expect(actionPrompt("check", "Findings", "")).not.toContain("earlier Build");
  });

  it("keeps the person's note", () => {
    expect(actionPrompt("build", "Findings", " new batch ")).toContain(
      "The person adds: new batch",
    );
  });
});
