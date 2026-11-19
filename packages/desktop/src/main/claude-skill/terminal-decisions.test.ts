import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CommittedDecisions } from "../committed-decisions.ts";
import { personSaid, terminalHandler, type TerminalDeps } from "./terminal.ts";

// Personal decisions live in the home folder: never the real one in a test.
process.env.HOME = mkdtempSync(path.join(tmpdir(), "anur-test-home-"));

const said = (...texts: string[]) =>
  texts
    .map((t, i) =>
      JSON.stringify({
        type: "user",
        uuid: `u${String(i)}`,
        message: { role: "user", content: t },
      }),
    )
    .join("\n");

function setup(transcript: string) {
  const folder = mkdtempSync(path.join(tmpdir(), "anur-term-"));
  const api = path.join(folder, "api");
  mkdirSync(api);
  execFileSync("git", ["-C", api, "init", "-q"]);
  const deps = {
    front: () => ({ folder, docs: [], webContentsId: 1 }),
    committed: (base: string) =>
      new CommittedDecisions(base, "mac-a", () => Promise.resolve("sam")),
    me: () => Promise.resolve("Sam"),
    transcript: () => Promise.resolve(transcript),
  } as unknown as TerminalDeps;
  return { folder, api, call: terminalHandler(deps) };
}
const lines = (f: string) =>
  readFileSync(f, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("decisions from a plain Claude Code session (23.4, 23.11)", () => {
  it("records a sure decision in the person's words for the repo the session works in", async () => {
    const { api, call } = setup(said("no, three retries, not infinite"));
    const r = await call("anur_note_decision", {
      quote: "three retries, not infinite",
      decision: "Three retries, not infinite.",
      confidence: 0.9,
      _cwd: api,
    });
    expect("text" in r && r.text).toContain("Recorded on this repo");
    const [line] = lines(path.join(api, ".anur/decisions/sam.jsonl"));
    expect(line).toMatchObject({ kind: "decision", scope: "repo", who: "Sam" });
    // Taken back before a commit: the line comes out.
    const id = "text" in r ? /id (term-\S+?)\.$/.exec(r.text)?.[1] : undefined;
    await call("anur_drop_decision", { id, _cwd: api });
    expect(readFileSync(path.join(api, ".anur/decisions/sam.jsonl"), "utf8").trim()).toBe("");
  });

  it("refuses words the person never typed, and asks first when unsure or for a finding", async () => {
    const { api, call } = setup(said("should we retry three times?"));
    const made = await call("anur_note_decision", {
      quote: "retry five times",
      decision: "Five retries.",
      confidence: 0.9,
      _cwd: api,
    });
    expect("error" in made).toBe(true);
    const asked = await call("anur_note_decision", {
      quote: "should we retry three times?",
      decision: "Three retries.",
      confidence: 0.9,
      _cwd: api,
    });
    expect("text" in asked && asked.text).toContain("Not recorded yet");
    const finding = await call("anur_propose_finding", {
      claim: "The job runs at 2am.",
      source: "cron.ts:4",
      _cwd: api,
    });
    expect("text" in finding && finding.text).toContain("Not kept yet");
    const kept = await call("anur_propose_finding", {
      claim: "The job runs at 2am.",
      source: "cron.ts:4",
      confirmed: true,
      _cwd: api,
    });
    expect("text" in kept && kept.text).toContain("Recorded");
    expect(lines(path.join(api, ".anur/decisions/sam.jsonl")).map((l) => l.kind)).toEqual([
      "finding",
    ]);
  });

  it("reads only what the person typed from a transcript", () => {
    const t = [
      JSON.stringify({
        type: "user",
        uuid: "a",
        message: { role: "user", content: "keep it at three" },
      }),
      JSON.stringify({
        type: "user",
        uuid: "b",
        isMeta: true,
        message: { role: "user", content: "meta" },
      }),
      JSON.stringify({
        type: "user",
        uuid: "c",
        message: { role: "user", content: [{ type: "tool_result", content: "x" }] },
      }),
      JSON.stringify({
        type: "user",
        uuid: "d",
        message: { role: "user", content: "<command-name>/anur</command-name>" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "e",
        message: { role: "assistant", content: "ok" },
      }),
    ].join("\n");
    expect(personSaid(t)).toEqual([{ id: "a", text: "keep it at three" }]);
  });
});
