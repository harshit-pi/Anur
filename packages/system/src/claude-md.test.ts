import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCK_BEGIN } from "@anur/core";
import { claudeMdFor, decisionFiles, writeClaudeMd } from "./claude-md.ts";

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
const line = (o: Record<string, unknown>) => `${JSON.stringify(o)}\n`;
const decision = (id: string, at: string, dev: string, text: string, who: string) =>
  line({
    id,
    at: `2026-11-18T10:00:${at}.000Z`,
    dev,
    seq: 0,
    kind: "decision",
    scope: "repo",
    ref: null,
    decision: text,
    quote: text,
    instead: null,
    until: null,
    who,
  });

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "anur-claudemd-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  writeFileSync(path.join(dir, "CLAUDE.md"), "# Api\n\nRun the tests first.\n");
  mkdirSync(path.join(dir, ".anur", "decisions"), { recursive: true });
  return dir;
}

describe("the CLAUDE.md block from a repo's decisions (23.5)", () => {
  it("writes the block from every person's file, after the person's own text, and then has nothing to change", () => {
    const dir = repo();
    writeFileSync(
      path.join(dir, ".anur/decisions/sam.jsonl"),
      decision("d-0000001", "01", "mac-a", "Three retries, not infinite.", "Sam"),
    );
    writeFileSync(
      path.join(dir, ".anur/decisions/priya.jsonl"),
      decision("d-0000002", "02", "mac-b", "Use Stripe for payments.", "Priya"),
    );
    expect(writeClaudeMd(dir)).toBe(true);
    const text = readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    expect(text.startsWith("# Api\n\nRun the tests first.\n\n" + BLOCK_BEGIN)).toBe(true);
    expect(text).toContain("- Three retries, not infinite. (Sam)");
    expect(text).toContain("- Use Stripe for payments. (Priya)");
    expect(writeClaudeMd(dir)).toBe(false);
  });

  it("writes byte-identical blocks for two people committing in the same repo", () => {
    const origin = repo();
    writeFileSync(
      path.join(origin, ".anur/decisions/sam.jsonl"),
      decision("d-0000001", "01", "mac-a", "Three retries.", "Sam"),
    );
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "-m", "Sam's decision");
    // Priya clones, adds hers, and both rebuild from what's committed.
    const priya = mkdtempSync(path.join(tmpdir(), "anur-claudemd-"));
    git(priya, "clone", "-q", origin, ".");
    writeFileSync(
      path.join(priya, ".anur/decisions/priya.jsonl"),
      decision("d-0000002", "02", "mac-b", "Use Stripe.", "Priya"),
    );
    git(priya, "add", "-A");
    git(
      priya,
      "-c",
      "user.email=p@example.com",
      "-c",
      "user.name=P",
      "commit",
      "-q",
      "-m",
      "Priya's",
    );
    git(origin, "pull", "-q", priya, "main");
    writeClaudeMd(origin, { staged: true });
    writeClaudeMd(priya, { staged: true });
    expect(readFileSync(path.join(origin, "CLAUDE.md"), "utf8")).toBe(
      readFileSync(path.join(priya, "CLAUDE.md"), "utf8"),
    );
  });

  it("with --staged, reads only the decisions about to be committed", () => {
    const dir = repo();
    writeFileSync(
      path.join(dir, ".anur/decisions/sam.jsonl"),
      decision("d-0000001", "01", "mac-a", "Staged one.", "Sam"),
    );
    git(dir, "add", ".anur/decisions/sam.jsonl");
    writeFileSync(
      path.join(dir, ".anur/decisions/priya.jsonl"),
      decision("d-0000002", "02", "mac-b", "Not staged.", "Priya"),
    );
    expect(decisionFiles(dir, true).map((f) => f.person)).toEqual(["sam"]);
    const { next } = claudeMdFor(dir, { staged: true });
    expect(next).toContain("Staged one.");
    expect(next).not.toContain("Not staged.");
  });

  it("takes the block out when every decision is dropped, leaving the person's file as it was", () => {
    const dir = repo();
    writeFileSync(
      path.join(dir, ".anur/decisions/sam.jsonl"),
      decision("d-0000001", "01", "mac-a", "Three retries.", "Sam") +
        line({
          id: "x-0000001",
          at: "2026-11-18T10:00:05.000Z",
          dev: "mac-a",
          seq: 1,
          kind: "dropped",
          target: "d-0000001",
        }),
    );
    expect(writeClaudeMd(dir)).toBe(false);
    expect(readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toBe(
      "# Api\n\nRun the tests first.\n",
    );
  });

  it("makes no CLAUDE.md in a repo without one and without decisions", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-claudemd-"));
    git(dir, "init", "-q");
    expect(claudeMdFor(dir)).toMatchObject({ next: null, changed: false });
  });
});
