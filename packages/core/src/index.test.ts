import { describe, expect, it } from "vitest";
import { FORMAT_VERSION } from "./index.ts";

describe("core", () => {
  it("starts at format 1", () => {
    expect(FORMAT_VERSION).toBe(1);
  });
});
