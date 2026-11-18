import { describe, expect, it } from "vitest";
import { formatTokens } from "./tokens.ts";

describe("a token count", () => {
  it("reads as people say it", () => {
    expect(formatTokens(840)).toBe("840");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(12_000)).toBe("12k");
    expect(formatTokens(250_300)).toBe("250k");
    expect(formatTokens(1_240_000)).toBe("1.2M");
  });
});
