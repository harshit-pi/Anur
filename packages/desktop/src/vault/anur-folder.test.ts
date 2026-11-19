import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
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
  it("creates it with format.json, .ignore, per-device lines and generated attributes", async () => {
    const opened = await openAnurFolder(root);
    expect(opened).toMatchObject({ mode: "writable", format: 1, created: true });
    expect(JSON.parse(read("format.json"))).toEqual({ format: 1 });
    expect(read(".gitignore")).toBe(
      "# Kept on each Mac, never committed\nopen/\nsystem/last-read.json\n",
    );
    expect(read(".gitattributes")).toBe("** linguist-generated=true\n");
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
    expect(read(".gitignore")).toMatch(/^\*\n/);
  });

  it("keeps the person's own lines in .gitignore and .gitattributes", async () => {
    await openAnurFolder(root);
    writeFileSync(anur(".gitignore"), "scratch/\n");
    writeFileSync(anur(".gitattributes"), "*.jsonl -diff\n");
    await openAnurFolder(root);
    expect(read(".gitignore")).toBe(
      "scratch/\n# Kept on each Mac, never committed\nopen/\nsystem/last-read.json\n",
    );
    expect(read(".gitattributes")).toBe("*.jsonl -diff\n");
    await openAnurFolder(root);
    expect(read(".gitignore")).toBe(
      "scratch/\n# Kept on each Mac, never committed\nopen/\nsystem/last-read.json\n",
    );
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
    mkdirSync(anur("open"));
    writeFileSync(anur("open", "mac-a.json"), "{}");
    mkdirSync(anur("system"));
    writeFileSync(anur("system", "last-read.json"), "{}");
    writeFileSync(anur("system", "review.jsonl"), "");
    expect(untracked()).toEqual(
      expect.arrayContaining([
        "?? doc.md",
        "?? .anur/format.json",
        "?? .anur/.ignore",
        "?? .anur/.gitattributes",
        "?? .anur/system/review.jsonl",
      ]),
    );
    // What one Mac keeps for itself stays out (18.10).
    expect(untracked().filter((l) => l.includes("open/") || l.includes("last-read"))).toEqual([]);
    expect(git("check-attr", "linguist-generated", ".anur/system/review.jsonl").trim()).toBe(
      ".anur/system/review.jsonl: linguist-generated: true",
    );
    expect(git("check-attr", "linguist-generated", "doc.md").trim()).toBe(
      "doc.md: linguist-generated: unspecified",
    );
    expect(existsSync(path.join(root, ".gitignore"))).toBe(false);
    expect(existsSync(path.join(root, ".gitattributes"))).toBe(false);

    writeFileSync(anur(".gitignore"), "*\n");
    expect(untracked()).toEqual(["?? doc.md"]);
  });
});
