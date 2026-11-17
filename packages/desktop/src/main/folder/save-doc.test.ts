import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FolderService } from "./folder-service.ts";
import { openDoc } from "./open-doc.ts";
import { saveDoc } from "./save-doc.ts";

let base: string;
let vault: string;
let plan: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), "anur-savedoc-")));
  vault = path.join(base, "Vault");
  mkdirSync(vault, { recursive: true });
  plan = path.join(vault, "Plan.md");
  writeFileSync(plan, "﻿# Plan\r\n\r\nOld.\r\n");
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

async function opened() {
  const r = await new FolderService(path.join(base, "AppSupport"), base).open(1, vault);
  if (r.kind !== "opened") throw new Error("expected the folder to open");
  const doc = await openDoc(r.folder, "Plan.md");
  if (doc.kind !== "doc") throw new Error("expected the doc to open");
  return { folder: r.folder, doc };
}

describe("saving the page", () => {
  it("writes the text with the file's own endings and byte-order mark", async () => {
    const { folder, doc } = await opened();
    const r = await saveDoc(folder, { path: "Plan.md", text: "# Plan\n\nNew.\n", base: doc.hash });
    expect(r.kind).toBe("saved");
    expect(readFileSync(plan, "utf8")).toBe("﻿# Plan\r\n\r\nNew.\r\n");
  });

  it("chains saves: each returns the hash the next one must match", async () => {
    const { folder, doc } = await opened();
    const first = await saveDoc(folder, {
      path: "Plan.md",
      text: "# Plan\n\nA.\n",
      base: doc.hash,
    });
    if (first.kind !== "saved") throw new Error("expected a save");
    const second = await saveDoc(folder, {
      path: "Plan.md",
      text: "# Plan\n\nB.\n",
      base: first.hash,
    });
    expect(second.kind).toBe("saved");
    expect(readFileSync(plan, "utf8")).toContain("B.");
    const stale = await saveDoc(folder, {
      path: "Plan.md",
      text: "# Plan\n\nC.\n",
      base: first.hash,
    });
    expect(stale.kind).toBe("changed");
  });

  it("never overwrites a file that changed outside Anur", async () => {
    const { folder, doc } = await opened();
    writeFileSync(plan, "# Plan\n\nFrom Obsidian.\n");
    const r = await saveDoc(folder, { path: "Plan.md", text: "# Plan\n\nMine.\n", base: doc.hash });
    expect(r).toEqual({ kind: "changed" });
    expect(readFileSync(plan, "utf8")).toBe("# Plan\n\nFrom Obsidian.\n");
  });

  it("treats a deleted file as changed outside Anur", async () => {
    const { folder, doc } = await opened();
    rmSync(plan);
    const r = await saveDoc(folder, { path: "Plan.md", text: "x", base: doc.hash });
    expect(r).toEqual({ kind: "changed" });
  });

  it.each(["../secret.md", "/etc/hosts", "Missing.md"])(
    "refuses a path it didn't list: %s",
    async (p) => {
      const { folder, doc } = await opened();
      const r = await saveDoc(folder, { path: p, text: "x", base: doc.hash });
      expect(r.kind).toBe("failed");
    },
  );

  it("refuses to write in a read-only folder", async () => {
    const { folder, doc } = await opened();
    const r = await saveDoc(
      { ...folder, mode: "read-only", reason: "Locked." },
      { path: "Plan.md", text: "x", base: doc.hash },
    );
    expect(r.kind).toBe("failed");
    expect(readFileSync(plan, "utf8")).toContain("Old.");
  });
});
