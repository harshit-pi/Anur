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
