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

  it("tells about a long trickle every so often, not once per file or only at the end", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "anur-watch-"));
    const told: number[] = [];
    watch = new FolderWatch((id) => told.push(id), 100, 400);
    watch.start(1, root);
    await wait(150);
    for (let i = 0; i < 12; i++) {
      writeFileSync(path.join(root, `${String(i)}.md`), "# A\n");
      await wait(60);
    }
    await wait(300);
    expect(told.length).toBeGreaterThanOrEqual(2);
    expect(told.length).toBeLessThanOrEqual(4);
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
