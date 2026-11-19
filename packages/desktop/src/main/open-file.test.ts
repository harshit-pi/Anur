import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { folderFor } from "./open-file.ts";

/** home/Notes (used by Anur, with Ideas inside), home/Downloads, and a file in each. */
function home() {
  const root = mkdtempSync(path.join(tmpdir(), "anur-open-"));
  mkdirSync(path.join(root, "Notes", ".anur"), { recursive: true });
  mkdirSync(path.join(root, "Notes", "Ideas"));
  mkdirSync(path.join(root, "Downloads"));
  writeFileSync(path.join(root, "Notes", "Ideas", "Gift.md"), "# Gift\n");
  writeFileSync(path.join(root, "Downloads", "readme.md"), "# Read me\n");
  return root;
}

describe("folderFor", () => {
  it("uses a folder already open that holds the file, the deepest one", async () => {
    const h = home();
    const file = path.join(h, "Notes", "Ideas", "Gift.md");
    const open = [path.join(h, "Notes"), path.join(h, "Notes", "Ideas")];
    expect(await folderFor(file, open, [], h)).toBe(path.join(h, "Notes", "Ideas"));
  });

  it("else the nearest folder above that Anur has used", async () => {
    const h = home();
    expect(await folderFor(path.join(h, "Notes", "Ideas", "Gift.md"), [], [], h)).toBe(
      path.join(h, "Notes"),
    );
  });

  it("else a recent folder that holds it, else the file's own folder", async () => {
    const h = home();
    const file = path.join(h, "Downloads", "readme.md");
    expect(await folderFor(file, [], [h], h)).toBe(h);
    expect(await folderFor(file, [], [path.join(h, "Notes")], h)).toBe(path.join(h, "Downloads"));
  });

  it("doesn't look above the home folder", async () => {
    const h = home();
    mkdirSync(path.join(h, "inner"));
    writeFileSync(path.join(h, "inner", "x.md"), "");
    // h's parent has no .anur either way; stopping at h keeps the answer the file's folder.
    expect(await folderFor(path.join(h, "inner", "x.md"), [], [], path.join(h, "inner"))).toBe(
      path.join(h, "inner"),
    );
  });

  it("never opens the home folder, though its own .anur holds the person's decisions", async () => {
    const h = home();
    // Since 18.3 the home folder has .anur, for decisions kept for everywhere.
    mkdirSync(path.join(h, ".anur"));
    expect(await folderFor(path.join(h, "Downloads", "readme.md"), [], [], h)).toBe(
      path.join(h, "Downloads"),
    );
  });
});
