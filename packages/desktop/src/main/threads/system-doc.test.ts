import { describe, expect, it } from "vitest";
import { systemDocText } from "@anur/core";
import { SYSTEM_DOC_ID, boxCounts, systemLocated, systemReach } from "./system-doc.ts";
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

  it("counts each box's decisions, and the ones that disagree there (29.9)", () => {
    const d = (id: string, scope: string, home: string, more: object = {}) => ({
      id,
      kind: "decision",
      scope,
      home,
      ref: null,
      ...more,
    });
    const entries = [
      d("a", "part:chk", "api"),
      d("b", "part:chk", "api", { against: "a" }),
      d("c", "repo", "api"),
      d("e", "edge:web/|api/|http|/v1/checkout", "web"),
      d("f", "everywhere", "~"),
      { ...d("g", "part:chk", "api"), kind: "finding" },
    ];
    const counts = boxCounts(entries, shape, ["repo:api1", "part:chk", "repo:web1"]);
    // The part: its two and the line's; the repo-wide one isn't the part's own.
    expect(counts["part:chk"]).toEqual({ decided: 3, disagree: 2 });
    // The repo: its part's, the line's and its own.
    expect(counts["repo:api1"]).toEqual({ decided: 4, disagree: 2 });
    expect(counts["repo:web1"]).toEqual({ decided: 1, disagree: 0 });
  });

  it("finds a line by an ID it had before lines were named by repo IDs (23.12)", () => {
    const renamed: typeof shape = {
      ...shape,
      edges: shape.edges.map((e) => ({
        ...e,
        id: "repoW/|repoA/chk|http|/v1/checkout",
        aliases: [e.id],
      })),
    };
    const old = decision("edge:web/|api/|http|/v1/checkout", "web", "web → Checkout");
    expect(systemReach(old, "part:chk", renamed)?.reach).toBe(2);
  });
});
