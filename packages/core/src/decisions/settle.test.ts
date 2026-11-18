import { describe, expect, it } from "vitest";
import { isQuestion, quotedFrom, settleRule } from "./settle.ts";

const said = [
  { id: "m1", text: "Make the paid plan line shorter." },
  { id: "m2", text: "No, three retries, not infinite. Stripe rate-limits us above that." },
  { id: "m3", text: "We shouldn't send anything in preview also right?" },
];

describe("settleRule", () => {
  it("settles a confident decision in the person's own words", () => {
    expect(settleRule("three retries, not infinite", 0.85, said)).toEqual({
      kind: "settle",
      from: "m2",
    });
  });

  it("waits for a Keep when the agent is unsure", () => {
    expect(settleRule("three retries, not infinite", 0.6, said)).toMatchObject({
      kind: "propose",
      why: "unsure",
    });
  });

  it("never settles a question silently", () => {
    expect(settleRule("We shouldn't send anything in preview", 0.95, said)).toMatchObject({
      kind: "propose",
      why: "question",
    });
  });

  it("refuses words the person never typed", () => {
    expect(settleRule("retry five times", 0.99, said).kind).toBe("refuse");
    expect(settleRule("ok", 0.99, said).kind).toBe("refuse");
  });

  it("matches across case, spacing and curly quotes", () => {
    expect(quotedFrom("NO,  three retries", said)?.id).toBe("m2");
    expect(quotedFrom("“three retries, not infinite”", said)?.id).toBe("m2");
    expect(isQuestion("three retries", said[1]?.text ?? "")).toBe(false);
  });
});
