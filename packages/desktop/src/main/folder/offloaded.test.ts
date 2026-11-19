import { mkdtemp, mkdir, open, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fetchOffloaded, inICloud, offloadedIn } from "./offloaded.ts";

describe("offloaded iCloud files", () => {
  it("finds files with a size but no blocks, and skips .git", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "offloaded-"));
    await mkdir(path.join(root, "notes"));
    await mkdir(path.join(root, ".git"));
    await writeFile(path.join(root, "notes", "here.md"), "on disk");
    // A sparse file holds no blocks, as an offloaded one does.
    for (const rel of ["notes/away.md", ".git/away"]) {
      const f = await open(path.join(root, rel), "w");
      await f.truncate(4096);
      await f.close();
    }
    expect(await offloadedIn(root)).toEqual([path.join(root, "notes", "away.md")]);
  });

  it("only asks iCloud for folders in iCloud Drive", async () => {
    const asked: string[][] = [];
    const root = await mkdtemp(path.join(tmpdir(), "offloaded-"));
    expect(
      await fetchOffloaded(root, (f) => {
        asked.push(f);
        return Promise.resolve();
      }),
    ).toBe(0);
    expect(asked).toEqual([]);
    expect(inICloud("/Users/a/Library/Mobile Documents/iCloud~md~obsidian/Documents/V")).toBe(
      process.platform === "darwin",
    );
  });
});
