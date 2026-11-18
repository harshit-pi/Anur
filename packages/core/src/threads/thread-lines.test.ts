import { describe, expect, it } from "vitest";
import { encodeLine, mergeLines, parseJsonl } from "../jsonl/lines.ts";
import { ThreadLine } from "./thread-lines.ts";

const HASH = "a".repeat(64);
const env = (seq: number, dev = "dev1") => ({
  id: `line-${dev}-${String(seq)}`,
  at: `2026-11-17T01:00:0${String(seq)}.000Z`,
  dev,
  seq,
});

/** One line of every kind, as a thread on "Retry timing" writes them. */
export const SAMPLE_THREAD = [
  {
    ...env(0),
    kind: "thread",
    thread: "t1",
    doc: "d1",
    section: "s-retry",
    title: "Should we retry on weekends?",
    start: "new",
    branchedFrom: null,
  },
  { ...env(1), kind: "session", session: "3ace2826-388c", event: "started" },
  {
    ...env(2),
    kind: "turn",
    turn: "u1",
    event: "start",
    agent: { name: "claude-code", version: "2.1.322" },
    adapter: { name: "claude-agent-acp", version: "0.107.3" },
    model: "claude-opus-5-5",
    stopReason: null,
    usage: null,
  },
  { ...env(3), kind: "message", turn: "u1", role: "person", text: "Weekends too?" },
  {
    ...env(4),
    kind: "tool",
    turn: "u1",
    toolUse: "toolu_01",
    name: "Read",
    input: { file_path: "/copies/t1/doc.md" },
    status: "completed",
    result: HASH,
  },
  { ...env(5), kind: "message", turn: "u1", role: "agent", text: "Yes, at the same times." },
  {
    ...env(6),
    kind: "turn",
    turn: "u1",
    event: "end",
    agent: null,
    adapter: null,
    model: null,
    stopReason: "end_turn",
    usage: { input: 1200, output: 80, cacheRead: 900, cacheWrite: 0 },
  },
  { ...env(7), kind: "state", state: "closed" },
];

describe("thread lines", () => {
  it("round-trips every kind through a file", () => {
    const text = SAMPLE_THREAD.map((l) => encodeLine(l)).join("");
    const parsed = parseJsonl(text, ThreadLine);
    expect(parsed).toEqual({ lines: SAMPLE_THREAD, tornTail: false, badLines: 0 });
  });

  it("combines a thread continued on two devices", () => {
    const a = SAMPLE_THREAD.slice(0, 4);
    const b = [
      { ...env(5, "dev2"), kind: "message", turn: "u2", role: "person", text: "From the laptop." },
    ];
    const merged = mergeLines(
      parseJsonl(b.map((l) => encodeLine(l)).join(""), ThreadLine).lines,
      parseJsonl(a.map((l) => encodeLine(l)).join(""), ThreadLine).lines,
    );
    expect(merged.map((l) => l.kind)).toEqual(["thread", "session", "turn", "message", "message"]);
  });

  it("keeps a kind added by a later version, as written", () => {
    const later = { ...env(8), kind: "verdict", text: "Retries stop at 3." };
    const parsed = parseJsonl(encodeLine(later), ThreadLine);
    expect(parsed.lines).toEqual([later]);
  });

  it.each([
    ["a tool result that is not a hash", { ...SAMPLE_THREAD[4], result: "not-a-hash" }],
    ["an unknown role", { ...SAMPLE_THREAD[3], role: "system" }],
    ["a thread ID that could leave its folder", { ...SAMPLE_THREAD[0], thread: "../t2" }],
    ["a turn with no turn ID", { ...SAMPLE_THREAD[2], turn: "" }],
  ])("refuses %s rather than reading it as another kind", (_, bad) => {
    expect(parseJsonl(`${JSON.stringify(bad)}\n`, ThreadLine)).toMatchObject({
      lines: [],
      badLines: 1,
    });
  });
});
