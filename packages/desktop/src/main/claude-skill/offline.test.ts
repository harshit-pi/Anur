import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CommittedDecisions } from "../committed-decisions.ts";
import { offlineDecision } from "./offline.ts";

process.env.HOME = mkdtempSync(path.join(tmpdir(), "anur-test-home-"));

const said = (text: string) =>
  JSON.stringify({ type: "user", uuid: "u0", message: { role: "user", content: text } });

describe("decisions with Anur closed (2026-11-19)", () => {
  it("records into the session's repo with the same checks, and names no doc", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "anur-off-"));
    execFileSync("git", ["-C", repo, "init", "-q"]);
    const sub = path.join(repo, "src");
    mkdirSync(sub);
    const at = { cwd: sub, appSupport: mkdtempSync(path.join(tmpdir(), "anur-support-")) };
    const deps = {
      committed: (base: string) =>
        new CommittedDecisions(base, "mac-a", () => Promise.resolve("sam")),
      me: () => Promise.resolve("Sam"),
      transcript: () => Promise.resolve(said("no, three retries, not infinite")),
    };
    const long = await offlineDecision(
      "anur_note_decision",
      {
        quote: "three retries, not infinite",
        decision: "We always retry three times and never retry forever.",
        confidence: 0.9,
      },
      at,
      deps,
    );
    expect("error" in long && long.error).toMatch(/someone's voice|at most 7 words/);
    const ok = await offlineDecision(
      "anur_note_decision",
      {
        quote: "three retries, not infinite",
        decision: "Three retries, not infinite.",
        confidence: 0.9,
      },
      at,
      deps,
    );
    expect("text" in ok && ok.text).toMatch(/Anur is closed/);
    const line = JSON.parse(
      readFileSync(path.join(repo, ".anur/decisions/sam.jsonl"), "utf8").trim(),
    ) as Record<string, unknown>;
    expect(line).toMatchObject({
      kind: "decision",
      decision: "Three retries, not infinite.",
      scope: "folder:src",
    });
    const doc = await offlineDecision(
      "anur_note_decision",
      { quote: "x", decision: "X.", confidence: 0.9, doc: "plan.md" },
      at,
      deps,
    );
    expect("error" in doc && doc.error).toMatch(/Anur is closed/);
  });
});
