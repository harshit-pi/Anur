import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FolderWatch } from "./folder-watch.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("FolderWatch", () => {
  let watch: FolderWatch | null = null;
  afterEach(() => {
    watch?.stop(1);
  });

  it("tells once about a burst of new files, and not about hidden ones", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "anur-watch-"));
    mkdirSync(path.join(root, ".anur"));
    const told: number[] = [];
    watch = new FolderWatch((id) => told.push(id), 100);
    watch.start(1, root);
    await wait(150);
    writeFileSync(path.join(root, ".anur", "state.json"), "{}");
    await wait(300);
    expect(told).toEqual([]);
    writeFileSync(path.join(root, "a.md"), "# A\n");
    writeFileSync(path.join(root, "b.md"), "# B\n");
    await wait(400);
    expect(told).toEqual([1]);
  });

  it("stops telling once stopped", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "anur-watch-"));
    const told: number[] = [];
    watch = new FolderWatch((id) => told.push(id), 50);
    watch.start(1, root);
    watch.stop(1);
    writeFileSync(path.join(root, "a.md"), "# A\n");
    await wait(200);
    expect(told).toEqual([]);
  });
});
