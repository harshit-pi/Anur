import { describe, expect, it } from "vitest";
import {
  currentEntries,
  gitignoreKeepingDecisions,
  loginFromEmail,
  personKey,
  sectionScope,
} from "./committed.ts";

/** A stand-in for SHA-256: hex of the text's char codes, enough to test the key's shape. */
const sha = (t: string) =>
  Array.from(t, (c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0");
const line = (o: Record<string, unknown>) => `${JSON.stringify(o)}\n`;
const env = (id: string, at: string, dev = "mac-a", seq = 0) => ({
  id,
  at: `2026-11-18T10:00:${at}.000Z`,
  dev,
  seq,
});
const decision = (id: string, at: string, text: string) => ({
  ...env(id, at),
  kind: "decision",
  scope: "repo",
  ref: null,
  decision: text,
  quote: text,
  instead: null,
  until: null,
  who: "Sam",
});

describe("committed decisions (18.9)", () => {
  it("folds every person's file, and a drop from anyone takes a decision back", () => {
    const sam =
      line(decision("dec-00001", "01", "Three retries")) +
      line(decision("dec-00002", "02", "Use Stripe"));
    const priya =
      line({
        ...env("fin-00001", "03", "mac-b"),
        kind: "finding",
        scope: "repo",
        ref: null,
        claim: "Job runs at 2am",
        source: "cron.ts:4",
      }) +
      // Priya drops Sam's decision from her own file, as for someone who left.
      line({ ...env("drp-00001", "04", "mac-b"), kind: "dropped", target: "dec-00001" });
    const now = currentEntries([
      { person: "sam", text: sam },
      { person: "priya", text: priya },
    ]);
    expect(now.map((e) => [e.id, e.kind, e.person])).toEqual([
      ["dec-00002", "decision", "sam"],
      ["fin-00001", "finding", "priya"],
    ]);
  });

  it("counts a line copied into two files once, and skips a torn last line", () => {
    const one = line(decision("dec-00001", "01", "Three retries"));
    const now = currentEntries([
      { person: "sam", text: one + '{"id":"torn' },
      { person: "sam-copy", text: one },
    ]);
    expect(now.map((e) => e.id)).toEqual(["dec-00001"]);
  });
});

describe("whose file", () => {
  it("is the GitHub login, from a noreply email or given, else an email hash with no email in it", () => {
    expect(loginFromEmail("123+Sam-K@users.noreply.github.com")).toBe("Sam-K");
    expect(loginFromEmail("sam@acme.com")).toBeNull();
    expect(personKey({ login: "Sam-K", email: "sam@acme.com" }, sha)).toBe("sam-k");
    const hashed = personKey({ login: null, email: "Sam@Acme.com " }, sha);
    expect(hashed).toMatch(/^e-[0-9a-f]{12}$/);
    expect(hashed).toBe(personKey({ login: null, email: "sam@acme.com" }, sha));
    expect(hashed).toBe(`e-${sha("sam@acme.com").slice(0, 12)}`);
    expect(personKey({ login: null, email: null }, sha)).toBeNull();
  });
});

describe(".anur/.gitignore with decisions committed", () => {
  it("leaves a folder that commits .anur/ alone, and opens decisions/ in one that doesn't", () => {
    expect(gitignoreKeepingDecisions(null)).toBeNull();
    const next = gitignoreKeepingDecisions("*\n");
    expect(next).toBe("*\n!.gitignore\n!decisions/\n!decisions/*.jsonl\n");
    expect(gitignoreKeepingDecisions(next)).toBeNull();
  });
});

describe("a section scope read through the opened folder (18.14)", () => {
  it("is the doc's path from the folder and its heading path, whatever home it was kept in", () => {
    expect(sectionScope("section:docs/design.md#Plan › Risks", "api")).toEqual({
      doc: "api/docs/design.md",
      path: ["Plan", "Risks"],
    });
    expect(sectionScope("section:plan.md#", "")).toEqual({ doc: "plan.md", path: [] });
    expect(sectionScope("part:abc", "api")).toBeNull();
  });
});
