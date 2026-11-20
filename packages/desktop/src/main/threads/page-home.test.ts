import { describe, expect, it } from "vitest";
import { pageHome } from "./page-home.ts";

const kept = ["attachments", "Research/Anur Brainstorming Product"];

describe("pageHome", () => {
  it("puts a page made in attachments beside the doc", () => {
    expect(
      pageHome("attachments/Anur Brainstorming Product/Overview/Metrics.md", "Anur.md", kept),
    ).toBe("Metrics.md");
    expect(pageHome("attachments/Metrics.md", "plans/Anur.md", kept)).toBe("plans/Metrics.md");
  });

  it("does the same for a folder the person attached", () => {
    expect(pageHome("Research/Anur Brainstorming Product/Pricing.md", "Anur.md", kept)).toBe(
      "Pricing.md",
    );
  });

  it("leaves a page anywhere else where the agent put it", () => {
    expect(pageHome("Go-to-market.md", "Anur.md", kept)).toBe("Go-to-market.md");
    expect(pageHome("plans/Roadmap.md", "Anur.md", kept)).toBe("plans/Roadmap.md");
    expect(pageHome("attachments-old/x.md", "Anur.md", kept)).toBe("attachments-old/x.md");
  });
});
