import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireFolderLock, lockFileFor } from "./folder-lock.ts";
import { FolderService } from "./folder-service.ts";
import { listDocs } from "./list-docs.ts";
import { readRecent, rememberFolder } from "./recent.ts";

let base: string;
let appSupport: string;
let vault: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), "anur-folder-")));
  appSupport = path.join(base, "AppSupport");
  vault = path.join(base, "Vault");
  mkdirSync(vault);
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const touch = (rel: string, text = "# x\n") => {
  const p = path.join(vault, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
};

describe("the folder lock", () => {
  it("is held by one process at a time, and lives in app support, not the vault", async () => {
    const mine = await acquireFolderLock(appSupport, vault, { pid: 100, isAlive: () => true });
    expect(mine.ok).toBe(true);
    expect(lockFileFor(appSupport, vault).startsWith(appSupport)).toBe(true);
    const theirs = await acquireFolderLock(appSupport, vault, { pid: 200, isAlive: () => true });
    expect(theirs).toMatchObject({ ok: false, heldBy: { pid: 100, folder: vault } });
  });

  it("expires when the process that held it is gone", async () => {
    await acquireFolderLock(appSupport, vault, { pid: 100, isAlive: () => true });
    const after = await acquireFolderLock(appSupport, vault, {
      pid: 200,
      isAlive: (pid) => pid !== 100,
    });
    expect(after.ok).toBe(true);
  });

  it("is released, and only by its holder", async () => {
    const mine = await acquireFolderLock(appSupport, vault, { pid: 100, isAlive: () => true });
    if (!mine.ok) throw new Error("expected the lock");
    await mine.release();
    expect(existsSync(lockFileFor(appSupport, vault))).toBe(false);
    const again = await acquireFolderLock(appSupport, vault, { pid: 300, isAlive: () => true });
    expect(again.ok).toBe(true);
  });

  it("treats an unreadable lock file as stale", async () => {
    mkdirSync(path.dirname(lockFileFor(appSupport, vault)), { recursive: true });
    writeFileSync(lockFileFor(appSupport, vault), "garbage");
    expect((await acquireFolderLock(appSupport, vault, { pid: 1, isAlive: () => true })).ok).toBe(
      true,
    );
  });
});

describe("listing docs", () => {
  it("lists Markdown files outside dot-folders and node_modules, sorted as a person reads", async () => {
    touch("b.md");
    touch("A.md");
    touch("notes/Plan 10.md");
    touch("notes/Plan 2.md");
    touch("img.png", "x");
    touch(".obsidian/x.md");
    touch(".anur/y.md");
    touch("node_modules/pkg/README.md");
    expect((await listDocs(vault)).docs).toEqual([
      "A.md",
      "b.md",
      "notes/Plan 2.md",
      "notes/Plan 10.md",
    ]);
  });

  it("stops at the cap and says so", async () => {
    for (let i = 0; i < 5; i++) touch(`d${String(i)}.md`);
    expect(await listDocs(vault, 3)).toMatchObject({ truncated: true });
    expect((await listDocs(vault, 3)).docs).toHaveLength(3);
  });
});

describe("recent folders", () => {
  it("keep the latest first, once each", async () => {
    await rememberFolder(appSupport, "/a");
    await rememberFolder(appSupport, "/b");
    await rememberFolder(appSupport, "/a");
    expect(await readRecent(appSupport)).toEqual(["/a", "/b"]);
  });
});

describe("opening a folder", () => {
  it("creates .anur/, lists the docs, and remembers the folder", async () => {
    touch("Plan.md");
    const folders = new FolderService(appSupport);
    const r = await folders.open(1, vault);
    expect(r).toMatchObject({
      kind: "opened",
      folder: { name: "Vault", path: vault, mode: "writable", docs: ["Plan.md"] },
    });
    expect(existsSync(path.join(vault, ".anur", "format.json"))).toBe(true);
    expect(await readRecent(appSupport)).toEqual([vault]);
    expect(folders.current(1)?.path).toBe(vault);
  });

  it("points at the window that has the folder open, through a symlink too", async () => {
    const folders = new FolderService(appSupport);
    await folders.open(1, vault);
    const link = path.join(base, "link");
    symlinkSync(vault, link);
    expect(await folders.open(2, link)).toEqual({ kind: "elsewhere", windowId: 1 });
  });

  it("refuses a folder another copy of Anur holds, and a folder that isn't there", async () => {
    // Another live process holds it: this test's parent stands in for another copy of Anur.
    await acquireFolderLock(appSupport, vault, { pid: process.ppid });
    const folders = new FolderService(appSupport);
    const held = await folders.open(1, vault);
    expect(held.kind).toBe("refused");
    expect(held.kind === "refused" && held.reason).toMatch(/already open in another copy of Anur/);
    expect((await folders.open(1, path.join(base, "missing"))).kind).toBe("refused");
  });

  it("opens a folder whose format is newer read-only, saying why", async () => {
    mkdirSync(path.join(vault, ".anur"));
    writeFileSync(path.join(vault, ".anur", "format.json"), '{"format":99}');
    const r = await new FolderService(appSupport).open(1, vault);
    expect(r).toMatchObject({ kind: "opened", folder: { mode: "read-only" } });
    expect(r.kind === "opened" && r.folder.reason).toMatch(/Update Anur/);
  });

  it("releases the lock when the window closes, so another window can open it", async () => {
    const folders = new FolderService(appSupport);
    await folders.open(1, vault);
    await folders.close(1);
    expect(await folders.open(2, vault)).toMatchObject({ kind: "opened" });
  });
});
