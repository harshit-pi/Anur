import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LineEnvelope, encodeLine } from "@anur/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { JsonlWriter, readJsonlFile } from "./jsonl-writer.ts";

const Line = LineEnvelope.extend({ text: z.string() });
let dir: string;
let file: string;
let clock: number;
const now = () => clock;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "anur-jsonl-"));
  file = path.join(dir, "docs", "d1", "ids", "dev1.jsonl");
  clock = Date.UTC(2026, 10, 17, 1);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const read = () => readJsonlFile(file, Line);

describe("the JSONL writer", () => {
  it("writes stamped lines and carries the counter on after reopening", async () => {
    const w = await JsonlWriter.open(file, "dev1", { now });
    await w.append({ text: "a" });
    await w.append({ text: "b" });
    await w.close();
    const again = await JsonlWriter.open(file, "dev1", { now });
    const c = await again.append({ text: "c" });
    await again.close();
    const { lines } = await read();
    expect(lines.map((l) => [l.text, l.seq, l.dev])).toEqual([
      ["a", 0, "dev1"],
      ["b", 1, "dev1"],
      ["c", 2, "dev1"],
    ]);
    expect(c.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it("never steps back in time when the clock does", async () => {
    const w = await JsonlWriter.open(file, "dev1", { now });
    const a = await w.append({ text: "a" });
    clock -= 60_000;
    const b = await w.append({ text: "b" });
    await w.close();
    expect(b.at >= a.at).toBe(true);
  });

  it("keeps the order of appends made at once", async () => {
    const w = await JsonlWriter.open(file, "dev1", { now });
    await Promise.all(Array.from({ length: 50 }, (_, i) => w.append({ text: String(i) })));
    await w.close();
    const { lines } = await read();
    expect(lines.map((l) => l.text)).toEqual(Array.from({ length: 50 }, (_, i) => String(i)));
    expect(lines.map((l) => l.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("allows one writer per file", async () => {
    const w = await JsonlWriter.open(file, "dev1", { now });
    await expect(JsonlWriter.open(file, "dev1", { now })).rejects.toThrow(/already has a writer/);
    await w.close();
    await (await JsonlWriter.open(file, "dev1", { now })).close();
  });
});

describe("after a crash", () => {
  it("loses nothing written whole, at any point a write is cut off", async () => {
    const w = await JsonlWriter.open(file, "dev1", { now });
    await w.append({ text: "kept 1" });
    await w.append({ text: "kept 2" });
    await w.close();
    const before = readFileSync(file, "utf8");
    const torn = encodeLine({
      id: "torn-line-01",
      at: "2026-11-17T02:00:00.000Z",
      dev: "dev1",
      seq: 2,
      text: "lost",
    });

    for (let cut = 1; cut < torn.length - 1; cut++) {
      rmSync(file);
      appendFileSync(file, before + torn.slice(0, cut));
      expect((await read()).lines.map((l) => l.text)).toEqual(["kept 1", "kept 2"]);

      const again = await JsonlWriter.open(file, "dev1", { now });
      await again.append({ text: "after" });
      await again.close();
      const after = await read();
      expect(after.lines.map((l) => l.text)).toEqual(["kept 1", "kept 2", "after"]);
      expect(after).toMatchObject({ tornTail: false, badLines: 0 });
    }
  });

  it("keeps a whole line that only lost its newline, and continues after it", async () => {
    const whole = encodeLine({
      id: "whole-line-1",
      at: "2026-11-17T02:00:00.000Z",
      dev: "dev1",
      seq: 0,
      text: "whole",
    });
    const w0 = await JsonlWriter.open(file, "dev1", { now });
    await w0.close();
    appendFileSync(file, whole.trimEnd());
    const w = await JsonlWriter.open(file, "dev1", { now });
    const next = await w.append({ text: "next" });
    await w.close();
    expect((await read()).lines.map((l) => l.text)).toEqual(["whole", "next"]);
    expect(next.seq).toBe(1);
  });

  it("reads a missing file as empty", async () => {
    expect(await read()).toEqual({ lines: [], tornTail: false, badLines: 0 });
  });
});
