import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FolderState } from "../../shared/ipc-contract.ts";
import { planLinkUpdates } from "./link-updates.ts";

describe("planning link updates", () => {
  it("finds each doc whose links a rename broke, leaving out docs still in iCloud", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "anur-links-"));
    mkdirSync(path.join(root, "Ideas"));
    writeFileSync(path.join(root, "Home.md"), "See [[Plan]] and [p](Ideas/Plan.md).\n");
    writeFileSync(path.join(root, "Cloud.md"), "[[Plan]]\n");
    writeFileSync(path.join(root, "Other.md"), "No links here.\n");
    writeFileSync(path.join(root, "Ideas", "Plan.md"), "# Plan\n");
    renameSync(path.join(root, "Ideas", "Plan.md"), path.join(root, "Ideas", "Roadmap.md"));
    const folder: FolderState = {
      name: "f",
      path: root,
      mode: "writable",
      reason: null,
      docs: ["Cloud.md", "Home.md", "Ideas/Roadmap.md", "Other.md"],
      folders: ["Ideas"],
      files: [],
      times: {},
      truncated: false,
      cloud: null,
      gitInCloud: false,
      offloaded: ["Cloud.md"],
      conflicts: [],
    };
    const changes = await planLinkUpdates(folder, [
      { from: "Ideas/Plan.md", to: "Ideas/Roadmap.md" },
    ]);
    expect(changes.map((c) => [c.rel, c.links, c.next])).toEqual([
      ["Home.md", 2, "See [[Roadmap]] and [p](Ideas/Roadmap.md).\n"],
    ]);
  });

  it("follows a renamed image in embeds and Markdown images", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "anur-links-"));
    mkdirSync(path.join(root, "img"));
    writeFileSync(path.join(root, "Home.md"), "![[photo.png|200]] and ![p](img/photo.png)\n");
    writeFileSync(path.join(root, "img", "cover.png"), "png");
    const folder: FolderState = {
      name: "f",
      path: root,
      mode: "writable",
      reason: null,
      docs: ["Home.md"],
      folders: ["img"],
      files: ["img/cover.png"],
      times: {},
      truncated: false,
      cloud: null,
      gitInCloud: false,
      offloaded: [],
      conflicts: [],
    };
    const changes = await planLinkUpdates(folder, [{ from: "img/photo.png", to: "img/cover.png" }]);
    expect(changes.map((c) => c.next)).toEqual(["![[cover.png|200]] and ![p](img/cover.png)\n"]);
  });
});
