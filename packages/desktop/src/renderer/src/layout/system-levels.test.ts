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

describe("the system tab's levels (group 20)", () => {
  it("shows repos on top, by name ignoring case, empty ones last, saying what each holds", () => {
    expect(boxesAt(all, null)).toEqual([
      { id: "repo:a", name: "api", line: "3 parts in 1 group", opens: true, empty: false },
      { id: "repo:c", name: "Billing", line: "1 part", opens: true, empty: false },
      { id: "repo:b", name: "scripts", line: "No build file", opens: false, empty: true },
    ]);
  });

  it("opens one level at a time, parts last", () => {
    expect(boxesAt(all, "group:a/tables").map((b) => [b.name, b.line, b.opens])).toEqual([
      ["User", "2 parts", true],
      ["OrdersTable", "stack in cdk.json", false],
    ]);
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
