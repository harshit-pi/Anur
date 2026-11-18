import { describe, expect, it } from "vitest";
import { groupParts, wordsOf } from "./groups.ts";

const many = (prefix: string, n: number, suffix: string) =>
  Array.from({ length: n }, (_, i) => `${prefix}${String.fromCharCode(65 + i)}x${suffix}`);

describe("groupParts: one level at a time (group 20)", () => {
  it("leaves a repo with twelve parts or fewer as it is", () => {
    expect(groupParts(many("Thing", 12, "Stack"))).toBeNull();
  });

  it("groups by what the name says, folding single-part kinds into Services", () => {
    const names = [
      ...many("Users", 3, "DynamoDBStack"),
      ...many("Orders", 4, "SQSStack"),
      "ReportsS3Stack",
      "ReportsS4Stack",
      ...many("Api", 6, "Stack"),
    ];
    const g = groupParts(names) ?? [];
    expect(g.map((x) => [x.name, x.parts.length])).toEqual([
      ["Tables", 3],
      ["Queues", 4],
      ["Services", 8],
    ]);
    // Every part sits in exactly one group.
    expect(g.flatMap((x) => x.parts).sort()).toEqual([...names].sort());
  });

  it("reads keys and secrets, and splits a big group by a shared word, plural or not", () => {
    const names = [
      "AlgoReturnsAPIKeyStack",
      "PolygonKeyStack",
      "IBKRAuthCredentialsStack",
      "UsersTradingDynamoDB",
      "UserWalletDynamoDBStack",
      "UserBankDynamoDBStack",
      "PortfolioTradingDynamoDB",
      "PortfolioSnapshotsTradingDynamoDB",
      ...many("Lone", 9, "DynamoDB").map((n, i) => "QWERTYUIO".charAt(i) + n),
    ];
    const g = groupParts(names) ?? [];
    expect(g.find((x) => x.key === "secrets")?.parts).toHaveLength(3);
    const tables = g.find((x) => x.key === "tables");
    expect(tables?.groups?.map((x) => x.name)).toEqual(["Lone", "User", "Portfolio"]);
    expect(tables?.groups?.find((x) => x.name === "User")?.parts).toHaveLength(3);
  });

  it("splits camel case, acronyms and snake case into words", () => {
    expect(wordsOf("IBKRWebhookStack")).toEqual(["IBKR", "Webhook", "Stack"]);
    expect(wordsOf("pi_trading_client")).toEqual(["pi", "trading", "client"]);
  });
});
