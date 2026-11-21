import { describe, expect, it } from "vitest";
import { AWAY_MS, quietToRestart, type QuietState } from "./quiet-restart.ts";

const quiet: QuietState = {
  ready: true,
  auto: true,
  awayMs: AWAY_MS,
  threadsBusy: false,
  windowsQuiet: true,
};

describe("restarting into an update unasked", () => {
  it("restarts when an update is ready and nobody could notice", () => {
    expect(quietToRestart(quiet)).toBe(true);
  });

  it("waits while any of it isn't so", () => {
    expect(quietToRestart({ ...quiet, ready: false })).toBe(false);
    expect(quietToRestart({ ...quiet, auto: false })).toBe(false);
    expect(quietToRestart({ ...quiet, awayMs: null })).toBe(false);
    expect(quietToRestart({ ...quiet, awayMs: AWAY_MS - 1 })).toBe(false);
    expect(quietToRestart({ ...quiet, threadsBusy: true })).toBe(false);
    expect(quietToRestart({ ...quiet, windowsQuiet: false })).toBe(false);
  });
});
