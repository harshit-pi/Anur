import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAnurFolder } from "./anur-folder.ts";

let root: string;
const anur = (...p: string[]) => path.join(root, ".anur", ...p);
const read = (...p: string[]) => readFileSync(anur(...p), "utf8");

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "anur-folder-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("opening .anur/", () => {
  it("creates it with format.json and .ignore, committed with git by default", async () => {
    const opened = await openAnurFolder(root);
    expect(opened).toMatchObject({ mode: "writable", format: 1, created: true });
    expect(JSON.parse(read("format.json"))).toEqual({ format: 1 });
    expect(existsSync(anur(".gitignore"))).toBe(false);
    expect(read(".ignore")).toBe("*\n");
    expect(readdirSync(anur()).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("opens an existing folder without recreating it", async () => {
    await openAnurFolder(root);
    expect(await openAnurFolder(root)).toMatchObject({ mode: "writable", created: false });
  });

  it("puts back a missing .ignore, and leaves the folder's .gitignore choice as it is", async () => {
    await openAnurFolder(root);
    rmSync(anur(".ignore"));
    writeFileSync(anur(".gitignore"), "*\n");
    await openAnurFolder(root);
    expect(existsSync(anur(".ignore"))).toBe(true);
    expect(read(".gitignore")).toBe("*\n");
  });

  it("opens a newer folder read-only and leaves format.json alone", async () => {
    await openAnurFolder(root);
    writeFileSync(anur("format.json"), '{"format":99,"new":"field"}');
    rmSync(anur(".ignore"));
    const opened = await openAnurFolder(root);
    expect(opened.mode).toBe("read-only");
    expect(read("format.json")).toBe('{"format":99,"new":"field"}');
    expect(existsSync(anur(".ignore"))).toBe(false);
  });

  it("never overwrites an unreadable format.json", async () => {
    await openAnurFolder(root);
    writeFileSync(anur("format.json"), "garbage");
    expect((await openAnurFolder(root)).mode).toBe("read-only");
    expect(read("format.json")).toBe("garbage");
  });
});

describe("git and .anur/", () => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const untracked = () =>
    git("status", "--porcelain", "--untracked-files=all").trim().split("\n").filter(Boolean);

  it("is committed with the folder by default, and skipped once its .gitignore says so", async () => {
    git("init", "-q");
    writeFileSync(path.join(root, "doc.md"), "# Doc\n");
    await openAnurFolder(root);
    expect(untracked()).toEqual(
      expect.arrayContaining(["?? doc.md", "?? .anur/format.json", "?? .anur/.ignore"]),
    );
    expect(existsSync(path.join(root, ".gitignore"))).toBe(false);

    writeFileSync(anur(".gitignore"), "*\n");
    expect(untracked()).toEqual(["?? doc.md"]);
  });
});
