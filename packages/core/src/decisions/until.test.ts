import { describe, expect, it } from "vitest";
import { untilDate, untilPassed } from "./until.ts";

const kept = "2026-11-18T10:00:00.000Z";
const on = (s: string) => new Date(`${s}T12:00:00.000Z`);

describe('when an "until" has passed (18.2)', () => {
  it("reads the dates people write, and nothing else", () => {
    expect(untilDate("2026-12-01", kept)?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(untilDate("until Dec 1", kept)?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(untilDate("the 1st of December 2027", kept)?.toISOString()).toBe(
      "2027-12-01T00:00:00.000Z",
    );
    expect(untilDate("1 December 2027", kept)?.toISOString()).toBe("2027-12-01T00:00:00.000Z");
    expect(untilDate("December 1, 2027", kept)?.toISOString()).toBe("2027-12-01T00:00:00.000Z");
    // No year: the next one on or after the day it was kept.
    expect(untilDate("Jan 5", kept)?.toISOString()).toBe("2027-01-05T00:00:00.000Z");
    expect(untilDate("Nov 18", kept)?.toISOString()).toBe("2026-11-18T00:00:00.000Z");
    for (const s of ["for now", "until launch", "Feb 30", "may we", "end of Q1"])
      expect(untilDate(s, kept)).toBeNull();
  });

  it("lapses only after the whole named day", () => {
    expect(untilPassed("Dec 1", kept, on("2026-12-01"))).toBe(false);
    expect(untilPassed("Dec 1", kept, on("2026-12-02"))).toBe(true);
    expect(untilPassed("for now", kept, on("2030-01-01"))).toBe(false);
    expect(untilPassed(null, kept, on("2030-01-01"))).toBe(false);
  });
});
