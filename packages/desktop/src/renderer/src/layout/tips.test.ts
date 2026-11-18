import { describe, expect, it } from "vitest";
import { TIPS, isTipId, tipAt } from "./tips.ts";

describe("one-time tips", () => {
  it("are short: a title and one or two sentences", () => {
    for (const t of Object.values(TIPS)) {
      expect(t.title.length).toBeLessThan(30);
      expect(t.text.length).toBeLessThan(110);
    }
    expect(isTipId("fold")).toBe(true);
    expect(isTipId("nope")).toBe(false);
  });

  it("sit beside or under their anchor, inside the window", () => {
    const win = { width: 1200, height: 800 };
    const size = { width: 260, height: 90 };
    expect(tipAt({ left: 100, top: 200, width: 18, height: 18 }, "right", size, win)).toEqual({
      left: 130,
      top: 187,
    });
    expect(tipAt({ left: 1100, top: 10, width: 80, height: 30 }, "below", size, win)).toEqual({
      left: 932,
      top: 50,
    });
  });
});
