import { mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocWatcher, type OutsideChange } from "./doc-watcher.ts";
import { hashBytes } from "./save-doc.ts";

let dir: string;
let file: string;
let seen: OutsideChange[];
let watcher: DocWatcher;
const bytes = (s: string) => new TextEncoder().encode(s);
const settle = () => new Promise((r) => setTimeout(r, 400));

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "anur-watch-")));
  file = path.join(dir, "Plan.md");
  writeFileSync(file, "# Plan\n");
  seen = [];
  watcher = new DocWatcher((_id, change) => seen.push(change), 50);
  watcher.watch(1, dir, "Plan.md", hashBytes(bytes("# Plan\n")));
});
afterEach(() => {
  watcher.stopAll();
  rmSync(dir, { recursive: true, force: true });
});

describe("watching the open doc", () => {
  it("reports a change made outside Anur, with the new text", async () => {
    writeFileSync(file, "# Plan\r\n\r\nFrom Obsidian.\r\n");
    await settle();
    expect(seen).toEqual([
      {
        kind: "changed",
        path: "Plan.md",
        text: "# Plan\n\nFrom Obsidian.\n",
        hash: hashBytes(bytes("# Plan\r\n\r\nFrom Obsidian.\r\n")),
      },
    ]);
  });

  it("stays quiet about Anur's own save, recognised by its bytes", async () => {
    watcher.setHash(1, "Plan.md", hashBytes(bytes("# Plan\n\nMine.\n")));
    writeFileSync(file, "# Plan\n\nMine.\n");
    await settle();
    expect(seen).toEqual([]);
  });

  it("sees an atomic replace, as editors save", async () => {
    const tmp = path.join(dir, ".Plan.md.tmp");
    writeFileSync(tmp, "# Plan\n\nReplaced.\n");
    renameSync(tmp, file);
    await settle();
    expect(seen.map((c) => c.kind)).toEqual(["changed"]);
  });

  it("says when the doc is deleted or moved away", async () => {
    rmSync(file);
    await settle();
    expect(seen).toEqual([{ kind: "gone", path: "Plan.md" }]);
  });

  it("ignores other files in the folder", async () => {
    writeFileSync(path.join(dir, "Other.md"), "x");
    await settle();
    expect(seen).toEqual([]);
  });
});
