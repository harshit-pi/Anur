import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aboutFiles } from "./about.ts";
import { defaultRef, unmergedEntries, writeEdgeSides, writeLocalMd } from "./claude-local.ts";
import { twoRepoSystem } from "./fixtures.ts";

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "T",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "T",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
const decide = (dir: string, id: string, text: string) => {
  mkdirSync(path.join(dir, ".anur", "decisions"), { recursive: true });
  const file = path.join(dir, ".anur", "decisions", "sam.jsonl");
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(
    file,
    `${before}${JSON.stringify({ id, at: "2026-11-18T10:00:00.000Z", dev: "m", seq: 0, kind: "decision", scope: "repo", ref: null, decision: text, quote: text, instead: null, until: null, who: "Sam" })}\n`,
  );
};
const local = (dir: string) => path.join(dir, "CLAUDE.local.md");

/** A remote with main, and a clone of it: as a person's checkout. */
function clone() {
  const origin = mkdtempSync(path.join(tmpdir(), "anur-origin-"));
  git(origin, "init", "-q", "--bare", "-b", "main");
  const seed = mkdtempSync(path.join(tmpdir(), "anur-seed-"));
  git(seed, "init", "-q", "-b", "main");
  writeFileSync(path.join(seed, "README.md"), "# Api\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "Start");
  git(seed, "push", "-q", origin, "main");
  const dir = mkdtempSync(path.join(tmpdir(), "anur-clone-"));
  execFileSync("git", ["clone", "-q", origin, dir], { env });
  return { origin, dir };
}

describe("CLAUDE.local.md: one's own decisions not yet merged (23.9)", () => {
  it("lists a decision as soon as it's kept, in a file git ignores for this person alone", () => {
    const { dir } = clone();
    expect(defaultRef(dir)).toBe("origin/main");
    decide(dir, "d-0000001", "Three retries, never infinite.");
    expect(writeLocalMd(dir)).toBe(true);
    const text = readFileSync(local(dir), "utf8");
    expect(text).toContain("## Decisions not yet merged");
    expect(text).toContain("- Three retries, never infinite. (Sam)");
    // Ignored through .git/info/exclude: not in status, and .gitignore untouched.
    expect(git(dir, "status", "--porcelain")).not.toContain("CLAUDE.local.md");
    expect(readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8")).toContain(
      "/CLAUDE.local.md",
    );
    expect(existsSync(path.join(dir, ".gitignore"))).toBe(false);
    expect(writeLocalMd(dir)).toBe(false);
  });

  it("keeps it while the commit is only on a feature branch, and drops it once main has it", () => {
    const { origin, dir } = clone();
    git(dir, "switch", "-q", "-c", "feature");
    decide(dir, "d-0000001", "Three retries.");
    git(dir, "add", ".anur");
    git(dir, "commit", "-q", "-m", "A decision");
    writeLocalMd(dir);
    expect(unmergedEntries(dir).map((e) => e.id)).toEqual(["d-0000001"]);
    expect(readFileSync(local(dir), "utf8")).toContain("Three retries.");
    // Merged into main on the remote, as a PR does, then fetched.
    git(dir, "push", "-q", origin, "feature:main");
    git(dir, "fetch", "-q");
    expect(unmergedEntries(dir)).toEqual([]);
    expect(writeLocalMd(dir)).toBe(true);
    expect(existsSync(local(dir))).toBe(false);
  });

  it("lists only what main lacks, and keeps the person's own notes in the file", () => {
    const { origin, dir } = clone();
    decide(dir, "d-0000001", "On main already.");
    git(dir, "add", ".anur");
    git(dir, "commit", "-q", "-m", "First");
    git(dir, "push", "-q", origin, "HEAD:main");
    git(dir, "fetch", "-q");
    decide(dir, "d-0000002", "Not merged yet.");
    writeFileSync(local(dir), "My own local notes.\n");
    writeLocalMd(dir);
    const text = readFileSync(local(dir), "utf8");
    expect(text.startsWith("My own local notes.\n")).toBe(true);
    expect(text).toContain("- Not merged yet. (Sam)");
    expect(text).not.toContain("On main already.");
  });

  it("adds no exclude line where git already ignores the file, and lists everything with no default branch", () => {
    const { dir } = clone();
    writeFileSync(path.join(dir, ".gitignore"), "CLAUDE.local.md\n");
    decide(dir, "d-0000001", "Three retries.");
    writeLocalMd(dir);
    expect(readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8")).not.toContain("Anur");
    const bare = mkdtempSync(path.join(tmpdir(), "anur-fresh-"));
    git(bare, "init", "-q");
    decide(bare, "d-0000009", "Fresh repo rule.");
    expect(defaultRef(bare)).toBeNull();
    expect(unmergedEntries(bare).map((e) => e.id)).toEqual(["d-0000009"]);
  });
});

describe("decisions on calls, at the other end too (23.10)", () => {
  const onEdge = (dir: string, edge: string, text: string) => {
    mkdirSync(path.join(dir, ".anur", "decisions"), { recursive: true });
    writeFileSync(
      path.join(dir, ".anur", "decisions", "sam.jsonl"),
      `${JSON.stringify({ id: "d-edge-0001", at: "2026-11-18T10:00:00.000Z", dev: "m", seq: 0, kind: "decision", scope: `edge:${edge}`, ref: null, on: "@acme/web → @acme/api: /v1/users", decision: text, quote: text, instead: null, until: null, who: "Sam" })}\n`,
    );
  };

  it("lists a decision kept by the caller in the provider's CLAUDE.local.md, and takes it out when it goes", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "anur-sides-"));
    twoRepoSystem(folder);
    const edge = aboutFiles(folder, ["web/src/api.ts", "api/src/routes.ts"]);
    expect(edge?.kind).toBe("edge");
    onEdge(path.join(folder, "web"), edge?.scope.slice(5) ?? "", "Users list stays v1.");
    expect(writeEdgeSides(folder)).toEqual(["api"]);
    const text = readFileSync(local(path.join(folder, "api")), "utf8");
    expect(text).toContain("## Decisions on calls with other repos");
    expect(text).toContain("- Users list stays v1. (Sam, on @acme/web → @acme/api: /v1/users)");
    expect(text).toContain("<!-- anur:edges:begin -->");
    // Never in the repo that keeps it, nor anywhere git would commit it.
    expect(existsSync(local(path.join(folder, "web")))).toBe(false);
    expect(git(path.join(folder, "api"), "status", "--porcelain")).not.toContain("CLAUDE.local.md");
    // The person's own block beside it is left alone, and it them.
    decide(path.join(folder, "api"), "d-0000002", "Own rule.");
    writeLocalMd(path.join(folder, "api"));
    expect(writeEdgeSides(folder)).toEqual([]);
    const both = readFileSync(local(path.join(folder, "api")), "utf8");
    expect(both).toContain("Own rule.");
    expect(both).toContain("Users list stays v1.");
    // Dropped at the other end: it comes out, and the own block stays.
    writeFileSync(path.join(folder, "web", ".anur", "decisions", "sam.jsonl"), "");
    expect(writeEdgeSides(folder)).toEqual(["api"]);
    const after = readFileSync(local(path.join(folder, "api")), "utf8");
    expect(after).not.toContain("Users list stays v1.");
    expect(after).toContain("Own rule.");
  });
});
