import { describe, expect, it } from "vitest";
import { sessionsToClose } from "./host.ts";

const min = 60_000;

describe("the live-session limit", () => {
  const used = new Map([
    ["a", 0],
    ["b", 10 * min],
    ["c", 20 * min],
    ["d", 29 * min],
  ]);
  const now = 30 * min;

  it("closes the sessions idle longest, just enough to reach the limit", () => {
    expect(sessionsToClose(["a", "b", "c", "d"], new Set(), used, 2, now, 2 * min)).toEqual([
      "a",
      "b",
    ]);
    expect(sessionsToClose(["a", "b"], new Set(), used, 2, now, 2 * min)).toEqual([]);
  });

  it("never closes one with a turn running, or one that just finished", () => {
    // a is running; d finished a minute ago, inside the quiet spell.
    expect(sessionsToClose(["a", "b", "c", "d"], new Set(["a"]), used, 1, now, 2 * min)).toEqual([
      "b",
      "c",
    ]);
  });

  it("stays over the limit rather than cut anything busy", () => {
    expect(sessionsToClose(["c", "d"], new Set(["c"]), used, 0, now, 2 * min)).toEqual([]);
  });
});
