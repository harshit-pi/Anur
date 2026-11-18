import { describe, expect, it } from "vitest";
import { headingLikeness, suggestMatch, textLikeness } from "./orphans.ts";

describe("suggestMatch", () => {
  const live = [
    { path: ["Plan"], text: "# Plan\n\nThe launch plan." },
    {
      path: ["Plan", "Pricing and plans"],
      text: "## Pricing and plans\n\nFree for 3. Paid is £3 a month per flat.",
    },
    { path: ["Plan", "Risks"], text: "## Risks\n\n- Flatmates may not install." },
  ];

  it("finds a renamed section by its text", () => {
    const gone = {
      path: ["Plan", "Pricing"],
      text: "## Pricing\n\nFree for 3. Paid is £3 a month per flat.",
    };
    expect(suggestMatch(gone, live)).toBe(1);
  });

  it("falls back to the heading when no text was recorded", () => {
    expect(suggestMatch({ path: ["Plan", "Risk"], text: null }, live)).toBe(2);
  });

  it("suggests nothing when no section is close", () => {
    const gone = { path: ["Plan", "Hiring"], text: "## Hiring\n\nTwo engineers by March." };
    expect(suggestMatch(gone, live)).toBeNull();
  });

  it("scores headings and texts from 0 to 1", () => {
    expect(headingLikeness("Risks", "risks")).toBe(1);
    expect(headingLikeness("Risks", "Hiring")).toBeLessThan(0.3);
    expect(textLikeness("a b c", "a b c")).toBe(1);
    expect(textLikeness("", "a")).toBe(0);
  });
});
