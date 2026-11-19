import { describe, expect, it } from "vitest";
import { decisionNamed } from "./against.ts";

const kept = [
  { id: "a", claim: "Three retries, not infinite." },
  { id: "b", claim: "Use Stripe for payments." },
  { id: "c", claim: "Use Stripe for refunds." },
];

describe("the decision a new one goes against (18.4)", () => {
  it("is found by its words as listed, punctuation and case aside", () => {
    expect(decisionNamed("three retries, not infinite", kept)).toBe("a");
    expect(decisionNamed("Decided: Three retries, not infinite. (Sam)", kept)).toBe("a");
    expect(decisionNamed("Use Stripe for payments", kept)).toBe("b");
  });

  it("is none when the words match nothing, or more than one", () => {
    expect(decisionNamed("Five retries", kept)).toBeNull();
    expect(decisionNamed("Use Stripe", kept)).toBeNull();
    expect(decisionNamed("   ", kept)).toBeNull();
  });
});
