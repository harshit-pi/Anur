import { describe, expect, it } from "vitest";
import { systemDocText } from "@anur/core";
import { SYSTEM_DOC_ID, systemLocated, systemReach } from "./system-doc.ts";
import { boxes, shape } from "./system-doc.fixture.ts";

const decision = (scope: string, home: string, on: string | null = null) => ({ scope, home, on });

describe("a box on the system map as a section (29.1, 29.8)", () => {
  it("keys sections to the boxes' own IDs, from the text alone", () => {
    const text = systemDocText(boxes);
    const at = systemLocated(text);
    expect(at.doc).toBe(SYSTEM_DOC_ID);
    expect(at.ids.slice(1)).toEqual(["repo:api1", "part:chk", "repo:web1"]);
  });

  it("reaches a box: its part's, a line's from either end, its repo's, everywhere's; not a doc section's", () => {
    expect(systemReach(decision("part:chk", "api", "Checkout"), "part:chk", shape)).toEqual({
      label: "Checkout",
      reach: 0,
    });
    expect(systemReach(decision("part:chk", "api", "Checkout"), "repo:api1", shape)?.reach).toBe(1);
    expect(systemReach(decision("part:chk", "api"), "repo:web1", shape)).toBeNull();
    const line = decision(
      "edge:web/|api/|http|/v1/checkout",
      "web",
      "web → Checkout: /v1/checkout",
    );
    expect(systemReach(line, "repo:web1", shape)?.reach).toBe(2);
    expect(systemReach(line, "part:chk", shape)?.reach).toBe(2);
    expect(systemReach(line, "repo:api1", shape)?.reach).toBe(2);
    expect(systemReach(decision("repo", "api"), "part:chk", shape)).toEqual({
      label: "all of api",
      reach: 3,
    });
    expect(systemReach(decision("repo", "web"), "part:chk", shape)).toBeNull();
    expect(systemReach(decision("everywhere", "~"), "repo:web1", shape)?.reach).toBe(4);
    expect(systemReach(decision("section:README.md#Setup", "api"), "repo:api1", shape)).toBeNull();
  });
});
