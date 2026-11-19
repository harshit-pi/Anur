import { describe, expect, it } from "vitest";
import { boxesAt, edgeGroups, trailTo, type SystemSection } from "./system-levels.ts";

const s = (id: string, path: string[], parent: string | null, text = ""): SystemSection => ({
  id,
  path,
  text,
  parent,
});
const all = [
  s("repo:a", ["api"], null),
  s("group:a/tables", ["api", "Tables"], "repo:a"),
  s("group:a/tables/user", ["api", "Tables", "User"], "group:a/tables"),
  s("part:1", ["api", "UsersTable"], "group:a/tables/user", "stack in cdk.json"),
  s("part:2", ["api", "UserWalletTable"], "group:a/tables/user", "stack in cdk.json"),
  s("part:3", ["api", "OrdersTable"], "group:a/tables", "stack in cdk.json"),
  s("repo:b", ["scripts"], null),
  s("repo:c", ["Billing"], null),
  s("part:4", ["Billing", "billing"], "repo:c", "package in package.json"),
];
const view = (parent: string | null, reviewed = new Set<string>()) =>
  boxesAt(all, parent, reviewed).map((b) => [b.name, b.line, b.opens, b.unreviewed]);

describe("the system tab's levels (group 20)", () => {
  it("shows repos on top, by name ignoring case, empty ones last, saying what each holds", () => {
    expect(view(null)).toEqual([
      ["api", "3 parts in 1 group", true, 3],
      ["Billing", "1 part", true, 1],
      ["scripts", "No build file", false, 0],
    ]);
  });

  it("opens one level at a time, parts last, counting what the person hasn't seen", () => {
    expect(view("group:a/tables", new Set(["part:1"]))).toEqual([
      ["User", "2 parts", true, 1],
      ["OrdersTable", "stack in cdk.json", false, 1],
    ]);
    expect(boxesAt(all, "group:a/tables")[0]?.parts).toEqual(["part:1", "part:2"]);
  });

  it("gives the trail back to the top", () => {
    expect(trailTo(all, "group:a/tables/user").map((x) => x.path.at(-1))).toEqual([
      "api",
      "Tables",
      "User",
    ]);
    expect(trailTo(all, null)).toEqual([]);
  });
});

describe("lines between repos (group 22)", () => {
  const e = (id: string, from: string, to: string, state: "shown" | "hidden" = "shown") => ({
    id,
    from,
    to,
    kind: "http",
    label: "/x",
    how: "found" as const,
    evidence: "f:1",
    declared: null,
    state,
  });
  const edges = [
    e("1", "repo:b", "part:1"),
    e("2", "repo:b", "part:2"),
    e("3", "repo:b", "stub:outside:api.stripe.com"),
    e("4", "part:4", "part:3", "hidden"),
  ];

  it("groups edges by the repos they join, repos before outside services", () => {
    expect(edgeGroups(all, edges, null).map((g) => [g.from, g.to, g.stub, g.edges.length])).toEqual(
      [
        ["scripts", "api", null, 2],
        ["Billing", "api", null, 1],
        ["scripts", "api.stripe.com", "outside", 1],
      ],
    );
  });

  it("keeps only the edges touching the level shown", () => {
    expect(
      edgeGroups(all, edges, "group:a/tables/user").map((g) => g.edges.map((x) => x.id)),
    ).toEqual([["1", "2"]]);
  });
});
