import { describe, expect, it } from "vitest";
import { editsLand } from "./edits-land.ts";

const mode = (current: string) => [
  {
    id: "mode",
    name: "Mode",
    current,
    choices: ["default", "acceptEdits", "plan", "auto"].map((value) => ({
      value,
      name: value,
      description: null,
    })),
  },
];

describe("whether edits land as they come", () => {
  it("follows the thread's mode: acting modes land, asking and planning propose", () => {
    expect(editsLand(mode("auto"))).toBe(true);
    expect(editsLand(mode("acceptEdits"))).toBe(true);
    expect(editsLand(mode("default"))).toBe(false);
    expect(editsLand(mode("plan"))).toBe(false);
    expect(editsLand(undefined)).toBe(false);
  });
});
