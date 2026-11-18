import { describe, expect, it } from "vitest";
import { DAYS, readStar, shouldAsk, snoozed, used } from "./star-prompt.ts";

const empty = readStar({ getItem: () => null });

describe("star prompt", () => {
  it("asks only once Anur was used on enough different days", () => {
    let s = empty;
    for (let i = 1; i < DAYS; i++)
      s = used(used(s, `2026-11-0${String(i)}`), `2026-11-0${String(i)}`);
    expect(shouldAsk(s, "2026-11-09")).toBe(false);
    s = used(s, "2026-11-09");
    expect(shouldAsk(s, "2026-11-09")).toBe(true);
  });

  it("waits after one Not now, and stops after a second", () => {
    let s = empty;
    for (let i = 1; i <= DAYS; i++) s = used(s, `2026-11-0${String(i)}`);
    s = snoozed(s, new Date(2026, 10, 9));
    expect(shouldAsk(s, "2026-11-20")).toBe(false);
    expect(shouldAsk(s, "2026-12-09")).toBe(true);
    s = snoozed(s, new Date(2026, 11, 9));
    expect(shouldAsk(s, "2027-06-01")).toBe(false);
  });

  it("never asks again once done", () => {
    let s = empty;
    for (let i = 1; i <= DAYS; i++) s = used(s, `2026-11-0${String(i)}`);
    expect(shouldAsk({ ...s, done: true }, "2026-11-09")).toBe(false);
  });
});
