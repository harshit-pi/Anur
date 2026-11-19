import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEVICE_ONLY } from "@anur/core";
import { FolderService } from "./folder-service.ts";
import { isVault, markVault, vaultAbove } from "./vaults.ts";

const temp = (p: string) => realpathSync(mkdtempSync(path.join(tmpdir(), p)));
const vaultFile = (d: string) => path.join(d, ".anur", "vault.json");

describe("vaults (docs/anur-folder.md)", () => {
  it("are marked by vault.json, never by a .anur/ alone, as every repo has one", async () => {
    const root = temp("anur-vault-mark-");
    mkdirSync(path.join(root, "api", ".anur"), { recursive: true });
    expect(await isVault(root)).toBe(false);
    expect(await isVault(path.join(root, "api"))).toBe(false);
    await markVault(root);
    expect(await isVault(root)).toBe(true);
    expect(await vaultAbove(path.join(root, "api"))).toBe(root);
  });

  it("let a parent take over a vault inside it, its marker gone and its .anur/ kept", async () => {
    const root = temp("anur-vault-take-");
    const launch = path.join(root, "Launch");
    mkdirSync(path.join(launch, ".anur", "decisions"), { recursive: true });
    writeFileSync(path.join(launch, ".anur", "decisions", "sam.jsonl"), "{}\n");
    await markVault(launch);
    expect(await markVault(root)).toEqual(["Launch"]);
    expect(await isVault(launch)).toBe(false);
    expect(existsSync(path.join(launch, ".anur", "decisions", "sam.jsonl"))).toBe(true);
    // Opened on its own again, it's a vault again.
    await markVault(launch);
    expect(await isVault(launch)).toBe(true);
  });

  it("open a folder inside a vault as that vault, saying which folder was asked for", async () => {
    const root = temp("anur-vault-open-");
    mkdirSync(path.join(root, "Launch"));
    writeFileSync(path.join(root, "Launch", "plan.md"), "# Plan\n");
    const folders = new FolderService(temp("anur-vault-support-"));
    const first = await folders.open(1, root);
    expect(first.kind).toBe("opened");
    await folders.close(1);
    const inner = await folders.open(2, path.join(root, "Launch"));
    expect(inner).toMatchObject({ kind: "opened", inside: "Launch" });
    expect(inner.kind === "opened" && inner.folder.path).toBe(root);
    expect(await isVault(path.join(root, "Launch"))).toBe(false);
    await folders.close(2);
  });

  it("make the opened parent the vault over child vaults, with no question asked", async () => {
    const root = temp("anur-vault-parent-");
    const child = path.join(root, "Launch");
    mkdirSync(child);
    writeFileSync(path.join(child, "plan.md"), "# Plan\n");
    const folders = new FolderService(temp("anur-vault-support2-"));
    expect((await folders.open(1, child)).kind).toBe("opened");
    await folders.close(1);
    expect(await isVault(child)).toBe(true);
    const parent = await folders.open(2, root);
    expect(parent.kind === "opened" && parent.folder.path).toBe(root);
    expect(await isVault(root)).toBe(true);
    expect(await isVault(child)).toBe(false);
    await folders.close(2);
  });

  it("never commit vault.json: each Mac chooses its own vaults", async () => {
    expect(DEVICE_ONLY).toContain("vault.json");
    const root = temp("anur-vault-git-");
    execFileSync("git", ["-C", root, "init", "-q"]);
    const folders = new FolderService(temp("anur-vault-support3-"));
    expect((await folders.open(1, root)).kind).toBe("opened");
    expect(existsSync(vaultFile(root))).toBe(true);
    execFileSync("git", ["-C", root, "add", "-A"]);
    const staged = execFileSync("git", ["-C", root, "diff", "--cached", "--name-only"], {
      encoding: "utf8",
    });
    expect(staged).not.toContain("vault.json");
    expect(staged).toContain(".anur/format.json");
    await folders.close(1);
  });
});
