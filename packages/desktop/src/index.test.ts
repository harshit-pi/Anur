import { describe, expect, it } from "vitest";
import { appInfo } from "./index.ts";

describe("desktop", () => {
  it("reads core through the workspace", () => {
    expect(appInfo.formatVersion).toBe(1);
  });
});
