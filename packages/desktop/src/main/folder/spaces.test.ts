import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEVICE_ONLY } from "@anur/core";
import { FolderService } from "./folder-service.ts";
import { isSpace, markSpace, spaceAbove } from "./spaces.ts";

const temp = (p: string) => realpathSync(mkdtempSync(path.join(tmpdir(), p)));
const spaceFile = (d: string) => path.join(d, ".anur", "space.json");
/** Waits until `ok` holds: the walk for spaces inside runs after a folder opens. */
async function until(ok: () => Promise<boolean>) {
  for (let waited = 0; !(await ok()) && waited < 10_000; waited += 50)
    await new Promise((r) => setTimeout(r, 50));
}

describe("spaces (docs/anur-folder.md)", () => {
  it("are marked by space.json, never by a .anur/ alone, as every repo has one", async () => {
    const root = temp("anur-space-mark-");
    mkdirSync(path.join(root, "api", ".anur"), { recursive: true });
    expect(await isSpace(root)).toBe(false);
    expect(await isSpace(path.join(root, "api"))).toBe(false);
    await markSpace(root);
    expect(await isSpace(root)).toBe(true);
    expect(await spaceAbove(path.join(root, "api"))).toBe(root);
  });

  it("let a parent take over a space inside it, its marker gone and its .anur/ kept", async () => {
    const root = temp("anur-space-take-");
    const launch = path.join(root, "Launch");
    mkdirSync(path.join(launch, ".anur", "decisions"), { recursive: true });
    writeFileSync(path.join(launch, ".anur", "decisions", "sam.jsonl"), "{}\n");
    await markSpace(launch);
    expect(await markSpace(root)).toEqual(["Launch"]);
    expect(await isSpace(launch)).toBe(false);
    expect(existsSync(path.join(launch, ".anur", "decisions", "sam.jsonl"))).toBe(true);
    // Opened on its own again, it's a space again.
    await markSpace(launch);
    expect(await isSpace(launch)).toBe(true);
  });

  it("open a folder inside a space as that space, saying which folder was asked for", async () => {
    const root = temp("anur-space-open-");
    mkdirSync(path.join(root, "Launch"));
    writeFileSync(path.join(root, "Launch", "plan.md"), "# Plan\n");
    const folders = new FolderService(temp("anur-space-support-"));
    const first = await folders.open(1, root);
    expect(first.kind).toBe("opened");
    await folders.close(1);
    const inner = await folders.open(2, path.join(root, "Launch"));
    expect(inner).toMatchObject({ kind: "opened", inside: "Launch" });
    expect(inner.kind === "opened" && inner.folder.path).toBe(root);
    expect(await isSpace(path.join(root, "Launch"))).toBe(false);
    await folders.close(2);
  });

  it("open an existing space without walking it again", async () => {
    const root = temp("anur-space-again-");
    expect(await markSpace(root)).toEqual([]);
    // A marker planted inside after the fact isn't looked for: opening it would open the parent.
    mkdirSync(path.join(root, "inner", ".anur"), { recursive: true });
    writeFileSync(spaceFile(path.join(root, "inner")), "{}\n");
    expect(await markSpace(root)).toEqual([]);
  });

  it("make the opened parent the space over child spaces, with no question asked", async () => {
    const root = temp("anur-space-parent-");
    const child = path.join(root, "Launch");
    mkdirSync(child);
    writeFileSync(path.join(child, "plan.md"), "# Plan\n");
    const folders = new FolderService(temp("anur-space-support2-"));
    expect((await folders.open(1, child)).kind).toBe("opened");
    await folders.close(1);
    expect(await isSpace(child)).toBe(true);
    const parent = await folders.open(2, root);
    expect(parent.kind === "opened" && parent.folder.path).toBe(root);
    expect(await isSpace(root)).toBe(true);
    await until(async () => !(await isSpace(child)));
    expect(await isSpace(child)).toBe(false);
    await folders.close(2);
  });

  it("never commit space.json: each Mac chooses its own spaces", async () => {
    expect(DEVICE_ONLY).toContain("space.json");
    const root = temp("anur-space-git-");
    execFileSync("git", ["-C", root, "init", "-q"]);
    const folders = new FolderService(temp("anur-space-support3-"));
    expect((await folders.open(1, root)).kind).toBe("opened");
    expect(existsSync(spaceFile(root))).toBe(true);
    execFileSync("git", ["-C", root, "add", "-A"]);
    const staged = execFileSync("git", ["-C", root, "diff", "--cached", "--name-only"], {
      encoding: "utf8",
    });
    expect(staged).not.toContain("space.json");
    expect(staged).toContain(".anur/format.json");
    await folders.close(1);
  });
});
