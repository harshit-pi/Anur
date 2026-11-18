import { describe, expect, it } from "vitest";
import { describeChange } from "./describe.ts";

describe("describeChange", () => {
  it("names a short run of words that changed on one line", () => {
    expect(
      describeChange("## Pricing\n\nPaid: £4 a month.", "## Pricing\n\nPaid: £3 a month."),
    ).toBe("Changed “£4” to “£3”");
    expect(describeChange("Ship in March.", "Ship in March, quietly.")).toBe(
      "Changed “March.” to “March, quietly.”",
    );
  });

  it("counts lines added, removed or rewritten otherwise", () => {
    expect(describeChange("a\nb", "a\nb\nc\nd")).toBe("Added 2 lines");
    expect(describeChange("a\nb\nc", "a")).toBe("Removed 2 lines");
    expect(
      describeChange(
        "The first long line says one thing entirely.\nkeep",
        "A wholly different sentence replaces it here now.\nkeep",
      ),
    ).toBe("Rewrote 1 line");
  });

  it("says when there was nothing before", () => {
    expect(describeChange(null, "x")).toBe("First version");
  });
});
