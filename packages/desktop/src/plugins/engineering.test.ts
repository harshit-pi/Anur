import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PluginHost } from "@anur/core";
import { twoRepoSystem } from "../../../system/src/fixtures.ts";
import { engineering, systemSections } from "./engineering.ts";

describe("the engineering plugin's section source (group 20)", () => {
  it("gives repos as sections, their parts beneath them, in the index process", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-eng-"));
    twoRepoSystem(dir);
    const host = new PluginHost("index");
    await host.load(engineering);
    const [source] = host.sectionSources();
    expect(await source?.applies(dir)).toBe(true);
    const sections = await source?.sections(dir);
    expect(sections?.map((s) => s.path.join(" > "))).toEqual([
      "api",
      "api > @acme/api",
      "api > AcmeAlerts",
      "api > AcmeApi",
      "web",
      "web > @acme/web",
    ]);
    expect(
      systemSections(dir)
        .filter((s) => s.parent === null)
        .map((s) => s.text),
    ).toEqual(["acme/api", "acme/web"]);
    // Main keeps no section source: it runs in the index process.
    const main = new PluginHost("main");
    await main.load(engineering);
    expect(main.sectionSources()).toEqual([]);
  });
});

describe("a repo with many parts opens one level at a time (group 20)", () => {
  it("puts groups between the repo and its parts, keeping every part's ID", async () => {
    const { makeRepo } = await import("../../../system/src/fixtures.ts");
    const dir = mkdtempSync(path.join(tmpdir(), "anur-eng-"));
    const stacks = [
      ...["Users", "Orders", "Wallets", "Banks"].map((n) => `${n}DynamoDBStack`),
      ...["Trades", "Deposits", "Links"].map((n) => `${n}SQSStack`),
      ...["Webhook", "Order", "Tax", "Forms", "Reports", "Alerts", "Ledger"].map(
        (n) => `${n}Stack`,
      ),
    ];
    makeRepo(
      path.join(dir, "big"),
      {
        "cdk.json": JSON.stringify({ app: "npx ts-node bin/app.ts" }),
        "bin/app.ts": stacks.map((s) => `new ${s}(app, "${s}");`).join("\n"),
      },
      null,
    );
    const sections = systemSections(dir);
    const top = sections.find((s) => s.parent === null);
    if (!top) throw new Error("no repo");
    const under = (id: string) => sections.filter((s) => s.parent === id);
    expect(under(top.id).map((s) => s.path.at(-1))).toEqual(["Tables", "Queues", "Services"]);
    expect(under(top.id).every((s) => s.id.startsWith("group:"))).toBe(true);
    const parts = sections.filter((s) => s.id.startsWith("part:"));
    expect(parts.map((s) => s.path.at(-1)).sort()).toEqual([...stacks].sort());
    // A part's path is its repo and name, whatever group it sits in.
    expect(parts.every((s) => s.path.length === 2)).toBe(true);
  });
});

describe("one system per GitHub owner", () => {
  it("puts repos under their owner when the folder holds several", async () => {
    const { makeRepo } = await import("../../../system/src/fixtures.ts");
    const dir = mkdtempSync(path.join(tmpdir(), "anur-eng-"));
    makeRepo(
      path.join(dir, "app"),
      { "package.json": '{"name":"app"}' },
      "git@github.com:pitrade-official/app.git",
    );
    makeRepo(
      path.join(dir, "anur"),
      { "package.json": '{"name":"anur"}' },
      "https://github.com/HiAnur/anur.git",
    );
    makeRepo(path.join(dir, "scratch"), { "package.json": '{"name":"scratch"}' }, null);
    const s = systemSections(dir);
    expect(s.filter((x) => x.parent === null).map((x) => x.path[0])).toEqual([
      "HiAnur",
      "pitrade-official",
      "No remote",
    ]);
    expect(s.find((x) => x.path[0] === "app" && x.id.startsWith("repo:"))?.parent).toBe(
      "org:pitrade-official",
    );
  });
});
