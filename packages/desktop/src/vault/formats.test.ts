// Every .anur/ line format, written by the real writer and read back from disk.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ThreadLine, anurPaths } from "@anur/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonlWriter, readJsonlFile } from "./jsonl-writer.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "anur-formats-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const strip = <T extends Record<string, unknown>>(l: T) => {
  const { id: _i, at: _a, dev: _d, seq: _s, ...rest } = l;
  return rest;
};

describe("on disk", () => {
  it("round-trips thread lines at their own path", async () => {
    const file = path.join(dir, ".anur", anurPaths.thread("d1", "t1", "dev1"));
    const w = await JsonlWriter.open(file, "dev1");
    const written = [
      await w.append({ kind: "session", session: "abc", event: "started" }),
      await w.append({ kind: "message", turn: "u1", role: "person", text: "Hi" }),
    ];
    await w.close();
    const read = await readJsonlFile(file, ThreadLine);
    expect(read.badLines).toBe(0);
    expect(read.lines).toEqual(written);
    expect(read.lines.map(strip)).toEqual([
      { kind: "session", session: "abc", event: "started" },
      { kind: "message", turn: "u1", role: "person", text: "Hi" },
    ]);
  });
});
