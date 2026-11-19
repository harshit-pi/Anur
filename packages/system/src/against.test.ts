import { describe, expect, it } from "vitest";
import { AGAINST_SURE, againstPrompt, decisionsInScope, readAgainst } from "./against.ts";
import type { Edge } from "./edges.ts";
import type { Part } from "./parts.ts";

const parts: Part[] = [
  { id: "p-chk", repo: "api", kind: "stack", name: "Checkout", file: "api/bin/app.ts" },
  { id: "p-web", repo: "web", kind: "package", name: "@acme/web", file: "web/package.json" },
];
const edges: Edge[] = [
  {
    id: "R1/@acme/web|R2/Checkout|http|/v1/checkout",
    aliases: ["web/@acme/web|api/Checkout|http|/v1/checkout"],
    kind: "http",
    from: { repo: "web", part: "@acme/web" },
    to: { repo: "api", part: "Checkout" },
    route: "/v1/checkout",
    method: "POST",
    how: "found",
    evidence: "web/src/api.ts:4",
    declared: "api/src/routes.ts:9",
  },
];
const d = (id: string, scope: string, home: string, more: object = {}) => ({
  id,
  kind: "decision",
  scope,
  home,
  at: "2026-11-10T10:00:00.000Z",
  decision: `Decision ${id}`,
  quote: null,
  who: "Sam",
  until: null,
  ...more,
});
const report = {
  prompt: "Retry failed payments every night.",
  lines: [
    {
      category: "data" as const,
      repo: "api",
      part: "Checkout",
      file: "api/src/retry.ts",
      line: 3,
      text: "",
      how: "changed" as const,
    },
  ],
};

describe("decisions a task could go against (24.1)", () => {
  it("are the touched part's, the touched calls' and the repo's; not other repos', lapsed ones or doc sections'", () => {
    const entries = [
      d("part", "part:p-chk", "api"),
      d("other-part", "part:p-web", "web"),
      d("repo", "repo", "api"),
      d("web-repo", "repo", "web"),
      d("folder", "folder:src", "api"),
      d("lapsed", "repo", "api", { until: "2026-01-01" }),
      d("section", "section:README.md#Setup", "api"),
      { ...d("finding", "repo", "api"), kind: "finding" },
    ];
    const ids = decisionsInScope(report, entries, parts, edges, new Date("2026-11-18")).map(
      (x) => x.id,
    );
    expect(ids).toEqual(["part", "repo", "folder"]);
  });

  it("include a line's, saved under its old ID, when its route file is touched", () => {
    const touched = { lines: report.lines.map((l) => ({ ...l, file: "api/src/routes.ts" })) };
    const entries = [
      d("line", "edge:web/@acme/web|api/Checkout|http|/v1/checkout", "web", {
        on: "POST /v1/checkout",
      }),
    ];
    expect(decisionsInScope(touched, entries, parts, edges).map((x) => x.on)).toEqual([
      "on POST /v1/checkout",
    ]);
    expect(decisionsInScope(report, entries, parts, edges)).toEqual([]);
  });

  it("asks once, and reads the answer: sure asserted, unsure asked, low dropped, unknown ignored", () => {
    const inScope = decisionsInScope(
      report,
      [d("a", "repo", "api"), d("b", "part:p-chk", "api"), d("c", "folder:src", "api")],
      parts,
      edges,
    );
    const prompt = againstPrompt(report, inScope, "+ retry forever");
    expect(prompt).toContain("[a] Decision a");
    expect(prompt).toContain("+ retry forever");
    const found = readAgainst(
      `Here: {"against": [{"id": "a", "confidence": 0.9, "why": "Retries forever.", "file": "b/src/retry.ts", "line": 3}, {"id": "b", "confidence": 0.5, "why": "Maybe."}, {"id": "c", "confidence": 0.1}, {"id": "zzz", "confidence": 1}]}`,
      inScope,
    );
    expect(found.map((f) => [f.target, f.status])).toEqual([
      ["a", "asserted"],
      ["b", "asked"],
    ]);
    expect(found[0]).toMatchObject({ file: "src/retry.ts", line: 3, why: "Retries forever." });
    expect(AGAINST_SURE).toBe(0.7);
    expect(readAgainst("no json here", inScope)).toEqual([]);
  });
});
