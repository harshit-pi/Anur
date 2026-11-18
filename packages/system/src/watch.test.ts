import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { twoRepoSystem } from "./fixtures.ts";
import { scanSystem } from "./system.ts";
import { mattersForParts, watchSystem } from "./watch.ts";

describe("one watcher per repo (20.8)", () => {
  it("cares about build files and source, never output folders", () => {
    expect(mattersForParts("package.json")).toBe(true);
    expect(mattersForParts("infra/app.py")).toBe(true);
    expect(mattersForParts("node_modules/x/package.json")).toBe(false);
    expect(mattersForParts("cdk.out/manifest.json")).toBe(false);
    expect(mattersForParts(".git/HEAD")).toBe(false);
    expect(mattersForParts("README.md")).toBe(false);
  });

  it("sees a renamed package and updates the parts in under a second", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-watch-"));
    twoRepoSystem(dir);
    const t0 = { at: 0 };
    const seen = new Promise<number>((resolve) => {
      const stop = watchSystem(
        dir,
        () => {
          stop();
          const names = scanSystem(dir).parts.map((p) => p.name);
          resolve(names.includes("@acme/web-app") ? Date.now() - t0.at : -1);
        },
        100,
      );
    });
    // Give the watchers a moment to start, as the app's do.
    await new Promise((r) => setTimeout(r, 200));
    t0.at = Date.now();
    writeFileSync(path.join(dir, "web", "package.json"), JSON.stringify({ name: "@acme/web-app" }));
    const took = await seen;
    expect(took).toBeGreaterThan(0);
    expect(took).toBeLessThan(1000);
  });
});
