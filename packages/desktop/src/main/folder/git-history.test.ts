import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sectionCommits } from "./git-history.ts";

describe("sectionCommits", () => {
  it("lists the commits that changed one section, each with its text, newest first", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "anur-git-"));
    const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "T");
    const commit = async (text: string, msg: string) => {
      await writeFile(path.join(dir, "plan.md"), text);
      git("add", "plan.md");
      git("commit", "-qm", msg);
    };
    await commit("# Plan\n\n## Price\n\n£4\n\n## Risks\n\nNone.\n", "first");
    await commit("# Plan\n\n## Price\n\n£4\n\n## Risks\n\nSome.\n", "risks only");
    await commit("# Plan\n\n## Price\n\n£3\n\n## Risks\n\nSome.\n", "cheaper");
    const out = await sectionCommits(dir, "plan.md", ["Plan", "Price"]);
    expect(out.map((c) => [c.subject, c.text.trim()])).toEqual([
      ["cheaper", "## Price\n\n£3"],
      ["first", "## Price\n\n£4"],
    ]);
  });

  it("gives nothing outside a repo", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "anur-nogit-"));
    expect(await sectionCommits(dir, "plan.md", ["Plan"])).toEqual([]);
  });
});
