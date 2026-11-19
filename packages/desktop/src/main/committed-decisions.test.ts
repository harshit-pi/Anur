import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CommittedDecisions, decisionsHome } from "./committed-decisions.ts";

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });

function repo(dir: string) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "sam@acme.com");
  git(dir, "config", "user.name", "Sam");
  writeFileSync(path.join(dir, "notes.md"), "# Checkout\n");
}
const commitAll = (dir: string) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "x");
};
const read = (f: string) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
const decision = {
  kind: "decision" as const,
  decision: "Three retries",
  quote: "three retries, not infinite",
  instead: "infinite",
  until: null,
  who: "Sam",
};

describe("committed decisions (18.9)", () => {
  it("adds a kept decision to the person's file, and an Undo before a commit takes it out", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-dec-"));
    repo(dir);
    const store = new CommittedDecisions(dir, "mac-a", () => Promise.resolve("sam"));
    await store.keep("notes.md", "Checkout", "fnd-00000001", decision);
    const file = path.join(dir, ".anur/decisions/sam.jsonl");
    const [first] = read(file).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(first).toMatchObject({
      kind: "decision",
      scope: "section:notes.md#Checkout",
      ref: "fnd-00000001",
      decision: "Three retries",
    });
    // Kept twice: still one line.
    await store.keep("notes.md", "Checkout", "fnd-00000001", decision);
    expect(read(file)).toHaveLength(1);
    await store.drop("notes.md", "fnd-00000001");
    expect(read(file)).toHaveLength(0);
  });

  it("drops a committed decision with a line, so history keeps both, even one in another person's file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-dec-"));
    repo(dir);
    const sam = new CommittedDecisions(dir, "mac-a", () => Promise.resolve("sam"));
    await sam.keep("notes.md", "Checkout", "fnd-00000001", decision);
    commitAll(dir);
    // Priya drops Sam's committed decision, as for someone who left.
    const priya = new CommittedDecisions(dir, "mac-b", () => Promise.resolve("priya"));
    await priya.drop("notes.md", "fnd-00000001");
    expect(read(path.join(dir, ".anur/decisions/sam.jsonl"))).toHaveLength(1);
    const [dropped] = read(path.join(dir, ".anur/decisions/priya.jsonl")).map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    expect(dropped?.kind).toBe("dropped");
    expect(await sam.current(dir)).toEqual([]);
  });

  it("puts a doc's decisions in the repo holding it, and keeps them committed in a folder that opts out", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "anur-dec-"));
    const api = path.join(folder, "api");
    repo(api);
    mkdirSync(path.join(api, "docs"));
    writeFileSync(path.join(api, "docs/design.md"), "# Retries\n");
    mkdirSync(path.join(api, ".anur"));
    writeFileSync(path.join(api, ".anur/.gitignore"), "*\n");
    mkdirSync(path.join(api, ".anur/docs"));
    writeFileSync(path.join(api, ".anur/docs/thread.jsonl"), "{}\n");
    expect(await decisionsHome(folder, "api/docs/design.md")).toBe(api);
    expect(await decisionsHome(folder, "notes.md")).toBe(path.resolve(folder));

    const store = new CommittedDecisions(folder, "mac-a", () => Promise.resolve("sam"));
    await store.keep("api/docs/design.md", "Retries", "fnd-00000002", {
      kind: "finding",
      claim: "The job runs at 2am",
      source: "cron.ts:4",
    });
    const [line] = read(path.join(api, ".anur/decisions/sam.jsonl")).map(
      (l) => JSON.parse(l) as Record<string, unknown>,
    );
    expect(line?.scope).toBe("section:docs/design.md#Retries");
    git(api, "add", "-A");
    const staged = git(api, "diff", "--cached", "--name-only").trim().split("\n");
    expect(staged).toContain(".anur/decisions/sam.jsonl");
    expect(staged).not.toContain(".anur/docs/thread.jsonl");
  });
});
