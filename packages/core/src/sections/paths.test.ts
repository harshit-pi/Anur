import { describe, expect, it } from "vitest";
import { samePath, withoutHeading } from "./paths.ts";

describe("samePath", () => {
  it("matches equal paths only", () => {
    expect(samePath(["Plan", "Pricing"], ["Plan", "Pricing"])).toBe(true);
    expect(samePath(["Plan", "Pricing"], ["Plan"])).toBe(false);
    expect(samePath(["Plan", "Pricing"], ["Plan", "Risks"])).toBe(false);
    expect(samePath([], [])).toBe(true);
  });
  it("never matches a missing path", () => {
    expect(samePath(null, ["Plan"])).toBe(false);
    expect(samePath(["Plan"], undefined)).toBe(false);
    expect(samePath(null, null)).toBe(false);
  });
  it("doesn't confuse a name holding the join character", () => {
    expect(samePath(["a\u0000b"], ["a", "b"])).toBe(false);
  });
});

describe("withoutHeading", () => {
  it("drops the first line only when it's a heading", () => {
    expect(withoutHeading("## Pricing\nFree for 3.\n")).toBe("Free for 3.\n");
    expect(withoutHeading("###### Deep\tx\nBody")).toBe("Body");
    expect(withoutHeading("Free for 3.\n## Later")).toBe("Free for 3.\n## Later");
    expect(withoutHeading("#hashtag\nBody")).toBe("#hashtag\nBody");
    expect(withoutHeading("## Only")).toBe("");
  });
});
