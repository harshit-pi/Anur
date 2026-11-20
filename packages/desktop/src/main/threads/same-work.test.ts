import { describe, expect, it } from "vitest";
import { sameWork } from "./same-work.ts";

describe("sameWork", () => {
  it("finds the same work under another wording", () => {
    expect(sameWork("Draft the Roadmap page", "Draft the Roadmap and Milestones page")).toBe(true);
    expect(sameWork("Verify competitor prices", "Verify the competitor prices")).toBe(true);
  });

  it("keeps different work apart", () => {
    expect(sameWork("Draft the Metrics page", "Draft the Roadmap page")).toBe(false);
    expect(sameWork("Draft the Go-to-market page", "Draft the Pricing page")).toBe(false);
  });
});
