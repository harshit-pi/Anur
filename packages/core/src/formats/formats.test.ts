import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { LineEnvelope, encodeLine, mergeLines, parseJsonl } from "../jsonl/lines.ts";
import { HistoryLine } from "./history.ts";
import { InputSource, InputsLine, liveInputs, trustOf } from "./inputs.ts";
import { SettingsFile, mergeSettings, withSetting } from "./settings.ts";
import { TombstoneLine, deletedHashes } from "./snapshots.ts";

const HASH = "b".repeat(64);
let n = 0;
const env = (dev = "dev1") => ({
  id: `line-${String(++n).padStart(4, "0")}`,
  at: `2026-11-17T01:00:${String(n % 60).padStart(2, "0")}.000Z`,
  dev,
  seq: n,
});
function roundTrip<T extends LineEnvelope>(lines: readonly object[], schema: z.ZodType<T>) {
  return parseJsonl(lines.map((l) => encodeLine(l as never)).join(""), schema);
}

const noRef = { path: null, url: null, server: null, tool: null, command: null, question: null };
const input = (id: string, source: InputSource, extra = {}) => ({
  ...env(),
  kind: "input",
  input: id,
  section: "s-retry",
  thread: "t1",
  source,
  trust: trustOf(source),
  ref: noRef,
  hash: HASH,
  snapshot: true,
  partial: false,
  ...extra,
});

describe("input lines", () => {
  it("round-trip every source, and a removal", () => {
    const lines = [
      ...InputSource.options.map((s) => input(`in-${s}`, s)),
      { ...env(), kind: "removed", input: "in-file", section: "s-retry" },
    ];
    expect(roundTrip(lines, InputsLine)).toEqual({ lines, tornTail: false, badLines: 0 });
  });

  it("take trust from the kind of source", () => {
    expect(trustOf("doc")).toBe("person");
    expect(trustOf("attachment")).toBe("person");
    expect(trustOf("fetch")).toBe("untrusted");
    expect(trustOf("link")).toBe("untrusted");
    expect(trustOf("shell")).toBe("agent");
  });

  it("drop a removed input on every device, and only on its section", () => {
    const a = input("in-1", "file");
    const b = { ...input("in-1", "file"), section: "s-other" };
    const removed = { ...env("dev2"), kind: "removed", input: "in-1", section: "s-retry" };
    const merged = mergeLines(
      roundTrip([a, b], InputsLine).lines,
      roundTrip([removed], InputsLine).lines,
    );
    expect(liveInputs(merged).map((l) => l.section)).toEqual(["s-other"]);
  });

  it("refuse a hash that isn't one", () => {
    expect(roundTrip([input("x", "file", { hash: "nope" })], InputsLine).badLines).toBe(1);
  });
});

describe("history lines", () => {
  const version = (cause: string, preview: string | null) => ({
    ...env(),
    kind: "version",
    cause,
    text: "## Retry timing\n\nRetry after 30 minutes.\n",
    path: ["Failed-payment notifications", "Retry timing"],
    summary: "Shorter first retry",
    preview,
    thread: preview ? "t1" : null,
  });

  it("round-trip versions of every cause and an Apply's result", () => {
    const lines = [
      version("start", null),
      version("typing", null),
      version("apply", "p1"),
      { ...env(), kind: "apply-result", preview: "p1", result: "landed" },
      version("restore", null),
      version("outside", null),
    ];
    expect(roundTrip(lines, HistoryLine)).toEqual({ lines, tornTail: false, badLines: 0 });
  });

  it("tie an Apply, and only an Apply, to its preview", () => {
    expect(roundTrip([version("apply", null)], HistoryLine).badLines).toBe(1);
    expect(roundTrip([version("typing", "p1")], HistoryLine).badLines).toBe(1);
  });
});

describe("snapshot tombstones", () => {
  it("collect deleted hashes from every device", () => {
    const lines = [
      { ...env("dev1"), kind: "deleted", hash: HASH, reason: "person" },
      { ...env("dev2"), kind: "deleted", hash: "c".repeat(64), reason: "cleanup" },
    ];
    const parsed = roundTrip(lines, TombstoneLine);
    expect(parsed.lines).toEqual(lines);
    expect(deletedHashes(parsed.lines)).toEqual(new Set([HASH, "c".repeat(64)]));
  });
});

describe("settings", () => {
  it("let the latest change win per key, across devices", () => {
    const laptop = withSetting(
      withSetting({}, "git.commitAnur", false, "2026-11-17T01:00:00.000Z"),
      "sessions.limit",
      8,
      "2026-11-17T01:00:00.000Z",
    );
    const desktop = withSetting({}, "git.commitAnur", true, "2026-11-17T02:00:00.000Z");
    expect(
      mergeSettings([
        { dev: "laptop", settings: laptop },
        { dev: "desktop", settings: desktop },
      ]),
    ).toEqual({
      "git.commitAnur": true,
      "sessions.limit": 8,
    });
  });

  it("break a tie by device, the same way on every machine", () => {
    const at = "2026-11-17T01:00:00.000Z";
    const a = { dev: "devA", settings: withSetting({}, "x", 1, at) };
    const b = { dev: "devB", settings: withSetting({}, "x", 2, at) };
    expect(mergeSettings([a, b])).toEqual(mergeSettings([b, a]));
  });

  it("refuse keys that aren't dotted names", () => {
    expect(
      SettingsFile.safeParse({ "Bad Key": { value: 1, at: "2026-11-17T01:00:00.000Z" } }).success,
    ).toBe(false);
  });
});
