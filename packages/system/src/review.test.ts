import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PartGroup } from "./groups.ts";
import {
  appendReview,
  applyReview,
  parseProposals,
  readReview,
  reviewState,
  type ReviewLine,
} from "./review.ts";

const at = "2026-11-18T00:00:00Z";
const id = (key: string) => `group:r/${key}`;
const groups: PartGroup[] = [
  { key: "tables", name: "Tables", parts: ["A", "B"] },
  {
    key: "services",
    name: "Services",
    parts: [],
    groups: [
      { key: "services/copy", name: "Copy", parts: ["C1", "C2"] },
      { key: "services/other", name: "Other", parts: ["X", "Y"] },
      { key: "services/mirror", name: "Mirror", parts: ["M"] },
    ],
  },
];

describe("the review of the system (20.6)", () => {
  it("asks once, keeps proposals pending until the person answers", () => {
    const lines: ReviewLine[] = [
      { kind: "proposed", group: id("services/other"), name: "Reports", at },
      { kind: "proposed", group: id("tables"), name: "Data", at },
      { kind: "dismissed", group: id("tables"), at },
    ];
    const s = reviewState(lines);
    expect([...s.asked].sort()).toEqual([id("services/other"), id("tables")]);
    expect(s.pending.map((p) => p.name)).toEqual(["Reports"]);
    expect(applyReview(groups, id, s)[0]?.name).toBe("Tables");
  });

  it("applies an accepted name and merge, and a rename, without changing keys", () => {
    const s = reviewState([
      {
        kind: "proposed",
        group: id("services/copy"),
        name: "Copy trading",
        merge: [id("services/mirror")],
        at,
      },
      { kind: "accepted", group: id("services/copy"), at },
      { kind: "renamed", group: id("services/other"), name: "Jobs", at },
      { kind: "reviewed", parts: ["part:1"], at },
    ]);
    const subs = applyReview(groups, id, s)[1]?.groups ?? [];
    expect(subs.map((g) => [g.key, g.name, g.parts])).toEqual([
      ["services/copy", "Copy trading", ["C1", "C2", "M"]],
      ["services/other", "Jobs", ["X", "Y"]],
    ]);
    expect(s.pending).toEqual([]);
    expect(s.reviewed.has("part:1")).toBe(true);
  });

  it("reads back what it wrote, skipping a torn line", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-review-"));
    appendReview(dir, [{ kind: "renamed", group: id("tables"), name: "Data", at }]);
    expect(readReview(dir)).toHaveLength(1);
    expect(readReview(mkdtempSync(path.join(tmpdir(), "anur-review-")))).toEqual([]);
  });

  it("takes only proposals about known groups from the agent's reply", () => {
    const known = new Set([id("tables"), id("services/other")]);
    const reply = `Here you go:\n[{"id":"${id("tables")}","name":"Services › Ledgers ","merge":["${id("services/other")}","nope"]},{"id":"made-up","name":"X"}]`;
    expect(parseProposals(reply, known)).toEqual([
      { group: id("tables"), name: "Ledgers", merge: [id("services/other")] },
    ]);
    expect(parseProposals("no json", known)).toEqual([]);
  });
});
