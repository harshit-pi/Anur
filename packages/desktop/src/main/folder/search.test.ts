import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FolderState } from "../../shared/ipc-contract.ts";
import { createDoc, searchFolder } from "./search.ts";

function folder(): FolderState {
  const root = mkdtempSync(path.join(tmpdir(), "anur-search-"));
  mkdirSync(path.join(root, "Ideas"));
  writeFileSync(path.join(root, "Plan.md"), "# Plan\n\nWe ship on Monday.\nNo **Friday** ship.\n");
  writeFileSync(path.join(root, "Ideas", "Gift.md"), "# Gift\n\nA box that opens on Monday.\n");
  writeFileSync(path.join(root, "Cloud.md"), "Monday too, but not downloaded\n");
  return {
    name: "f",
    path: root,
    mode: "writable",
    reason: null,
    docs: ["Cloud.md", "Ideas/Gift.md", "Plan.md"],
    truncated: false,
    cloud: null,
    gitInCloud: false,
    offloaded: ["Cloud.md"],
    conflicts: [],
  };
}

describe("searching the folder", () => {
  it("finds each matching line, case ignored, leaving out docs still in iCloud", async () => {
    const r = await searchFolder(folder(), "monday");
    expect(r.matches.map((m) => `${m.path}:${String(m.line)}`)).toEqual([
      "Ideas/Gift.md:3",
      "Plan.md:3",
    ]);
    expect(r.matches[1]?.text).toBe("We ship on Monday.");
    expect(r.skipped).toBe(1);
  });

  it("stops at the limit and says so", async () => {
    const r = await searchFolder(folder(), "#", 1);
    expect(r.matches).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });

  it("finds nothing for an empty query", async () => {
    expect((await searchFolder(folder(), "  ")).matches).toEqual([]);
  });
});

describe("making a new doc", () => {
  it("writes its title as its first line, making its folder", async () => {
    const f = folder();
    expect(await createDoc(f, "Notes/Launch.md")).toEqual({
      kind: "created",
      path: "Notes/Launch.md",
    });
    expect(readFileSync(path.join(f.path, "Notes", "Launch.md"), "utf8")).toBe("# Launch\n\n");
  });

  it("never writes over a file, or outside the folder, or in a hidden folder", async () => {
    const f = folder();
    expect(await createDoc(f, "Plan.md")).toMatchObject({ kind: "failed" });
    expect(readFileSync(path.join(f.path, "Plan.md"), "utf8")).toContain("Monday");
    expect(await createDoc(f, "../Escape.md")).toMatchObject({ kind: "failed" });
    expect(await createDoc(f, ".anur/x.md")).toMatchObject({ kind: "failed" });
    expect(await createDoc(f, "Notes.txt")).toMatchObject({ kind: "failed" });
    expect(existsSync(path.join(f.path, "..", "Escape.md"))).toBe(false);
  });

  it("isn't allowed in a read-only folder", async () => {
    expect(await createDoc({ ...folder(), mode: "read-only" }, "New.md")).toEqual({
      kind: "failed",
      reason: "This folder is read-only.",
    });
  });
});
