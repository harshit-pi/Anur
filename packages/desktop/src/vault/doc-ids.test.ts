import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocIds } from "./doc-ids.ts";

let anurDir: string;
beforeEach(() => {
  anurDir = path.join(mkdtempSync(path.join(tmpdir(), "anur-docids-")), ".anur");
});
afterEach(() => {
  rmSync(path.dirname(anurDir), { recursive: true, force: true });
});

const open = async (device = "dev1") => {
  const ids = new DocIds(anurDir, device);
  await ids.load();
  return ids;
};

describe("doc IDs on disk", () => {
  it("survive reopening the folder", async () => {
    const first = await (await open()).idFor("plans/Retry.md");
    expect(await (await open()).idFor("plans/Retry.md")).toBe(first);
  });

  it("follow a move made in Anur, seen from another device", async () => {
    const mine = await open("dev1");
    const id = await mine.idFor("a.md");
    await mine.move(id, "a.md", "folder/b.md");
    const theirs = await open("dev2");
    expect(await theirs.idFor("folder/b.md")).toBe(id);
    expect(theirs.pathOf(id)).toBe("folder/b.md");
    expect(await theirs.idFor("a.md")).not.toBe(id);
  });

  it("keep an orphaned doc's ID out of reach of a new file at its path", async () => {
    const mine = await open();
    const id = await mine.idFor("a.md");
    await mine.orphan(id);
    const again = await open();
    const fresh = await again.idFor("a.md");
    expect(fresh).not.toBe(id);
    expect(again.pathOf(id)).toBe("a.md");
  });

  it("are the same when two devices first see one path", async () => {
    const a = await (await open("dev1")).idFor("shared.md");
    const b = await (await open("dev2")).idFor("shared.md");
    expect(a).toBe(b);
  });
});
