import { describe, expect, it } from "vitest";
import { changeSummary } from "./change-summary.ts";

describe("changeSummary", () => {
  it("shows only the words that change", () => {
    expect(changeSummary("The plan costs £5 a month.", "The plan costs £2.99 a month.")).toBe(
      "£5 → £2.99",
    );
  });

  it("shows what's added or cut", () => {
    expect(changeSummary("One.", "One. Two more.")).toBe("+ Two more.");
    expect(changeSummary("One. Two more.", "One.")).toBe("− Two more.");
  });

  it("clips long changes and ignores spacing alone", () => {
    expect(changeSummary("a b", "a  b")).toBe("No change");
    const long = changeSummary("Short.", "A much longer sentence that keeps going.");
    expect(long.startsWith("Short. → A much longer")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
  });
});
