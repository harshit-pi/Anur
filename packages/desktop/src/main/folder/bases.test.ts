import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FolderState } from "../../shared/ipc-contract.ts";
import { findBase, readEmbeddedBase } from "./bases.ts";

function folder(): FolderState {
  const root = mkdtempSync(path.join(tmpdir(), "anur-bases-"));
  mkdirSync(path.join(root, "Ideas"));
  mkdirSync(path.join(root, "Other"));
  writeFileSync(
    path.join(root, "Ideas.base"),
    "views:\n  - type: table\n    name: All\n    order: [file.name, score]\n",
  );
  writeFileSync(path.join(root, "Other", "Ideas.base"), "views: []\n");
  writeFileSync(path.join(root, "Ideas", "One.md"), "---\nscore: 6\n---\n# One\n");
  writeFileSync(path.join(root, "Ideas", "Two.md"), "# Two, no properties\n");
  return {
    name: "f",
    path: root,
    mode: "writable",
    reason: null,
    docs: ["Home.md", "Ideas/One.md", "Ideas/Two.md"],
    truncated: false,
    cloud: null,
    gitInCloud: false,
    offloaded: ["Home.md"],
    conflicts: [],
  };
}

describe("an embedded base, read in main", () => {
  it("finds the file by path, else by name nearest the page", async () => {
    const f = folder();
    expect(await findBase(f.path, "Other/Ideas.base", "Home.md")).toBe("Other/Ideas.base");
    expect(await findBase(f.path, "Ideas.base", "Other/Page.md")).toBe("Other/Ideas.base");
    expect(await findBase(f.path, "Ideas", "Home.md")).toBe("Ideas.base");
    expect(await findBase(f.path, "Missing.base", "Home.md")).toBeNull();
  });

  it("reads each note's properties, leaving out notes still in iCloud", async () => {
    const out = await readEmbeddedBase(folder(), "Ideas.base#All", "Home.md");
    if (out.kind !== "base") throw new Error(out.reason);
    expect(out.view).toBe("All");
    expect(out.skipped).toBe(1);
    expect(out.views[0]?.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ["One", "6"],
      ["Two", ""],
    ]);
  });

  it("says when there's no such base", async () => {
    expect(await readEmbeddedBase(folder(), "Nope.base", "Home.md")).toEqual({
      kind: "failed",
      reason: "There's no Nope.base in this folder.",
    });
  });
});
