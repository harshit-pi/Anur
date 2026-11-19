import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

describe("the opened folder's one reader (18.14)", () => {
  it("collects its own decisions and each repo's, saying which home each came from", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "anur-dec-"));
    writeFileSync(path.join(folder, "plan.md"), "# Plan\n");
    const api = path.join(folder, "api");
    repo(api);
    const store = new CommittedDecisions(folder, "mac-a", () => Promise.resolve("sam"));
    await store.keep("plan.md", "Plan", "fnd-00000003", decision);
    await store.keep("api/notes.md", "Checkout", "fnd-00000004", {
      ...decision,
      decision: "Use Stripe",
    });
    const all = await store.all(["api"]);
    expect(all.map((e) => [e.home, e.kind === "decision" ? e.decision : "", e.scope])).toEqual([
      ["", "Three retries", "section:plan.md#Plan"],
      ["api", "Use Stripe", "section:notes.md#Checkout"],
    ]);
  });
});

describe("the pre-commit hook comes with the first decision (23.6)", () => {
  it("puts Anur's lines in a repo's hook when a decision lands there, and in no plain folder", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "anur-dec-"));
    const api = path.join(folder, "api");
    repo(api);
    writeFileSync(path.join(folder, "plan.md"), "# Plan\n");
    const store = new CommittedDecisions(folder, "mac-a", () => Promise.resolve("sam"));
    await store.keep("api/notes.md", "Checkout", "fnd-00000010", decision);
    expect(readFileSync(path.join(api, ".git", "hooks", "pre-commit"), "utf8")).toContain(
      "# anur:pre-commit begin",
    );
    await store.keep("plan.md", "Plan", "fnd-00000011", decision);
    expect(existsSync(path.join(folder, ".git"))).toBe(false);
  });
});
