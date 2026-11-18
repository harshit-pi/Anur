import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeStartFolder } from "./new-folder.ts";

const temp = () => mkdtemp(path.join(tmpdir(), "anur-new-folder-"));

describe("makeStartFolder", () => {
  it("makes the folder", async () => {
    const full = path.join(await temp(), "Notes");
    expect(await makeStartFolder(full)).toEqual({ kind: "made" });
    expect((await stat(full)).isDirectory()).toBe(true);
  });

  it("uses a folder that is already there", async () => {
    const full = path.join(await temp(), "Notes");
    await mkdir(full);
    await writeFile(path.join(full, "a.md"), "# A\n");
    expect(await makeStartFolder(full)).toEqual({ kind: "made" });
  });

  it("refuses a file of that name", async () => {
    const full = path.join(await temp(), "Notes");
    await writeFile(full, "not a folder");
    const made = await makeStartFolder(full);
    expect(made.kind).toBe("failed");
  });

  it("refuses a place that doesn't exist", async () => {
    const full = path.join(await temp(), "missing", "Notes");
    expect((await makeStartFolder(full)).kind).toBe("failed");
  });
});
