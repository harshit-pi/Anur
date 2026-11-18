import { describe, expect, it } from "vitest";
import { boxesAt, trailTo, type SystemSection } from "./system-levels.ts";

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
