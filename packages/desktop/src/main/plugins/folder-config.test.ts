import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readFolderPlugins } from "./folder-config.ts";

let folder = "";
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

it("reads the newest of a settings file and the copies iCloud left, and folds the copies away", async () => {
  folder = mkdtempSync(path.join(tmpdir(), "anur-plugins-"));
  const dir = path.join(folder, ".anur", "plugins");
  mkdirSync(dir, { recursive: true });
  const put = (name: string, value: unknown, at: number) => {
    writeFileSync(path.join(dir, name), JSON.stringify(value));
    utimesSync(path.join(dir, name), at, at);
  };
  put("enabled.json", { on: ["git"] }, 1000);
  put("enabled 2.json", { on: ["git", "calendar"] }, 3000);
  put("enabled 3.json", "not settings", 4000);
  put("git.json", { remote: "new" }, 5000);
  put("git 2.json", { remote: "old" }, 2000);
  expect(await readFolderPlugins(folder)).toEqual({
    on: ["git", "calendar"],
    values: { git: { remote: "new" } },
  });
  expect(readdirSync(dir).sort()).toEqual(["enabled.json", "git.json"]);
});
