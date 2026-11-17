import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LineEnvelope, encodeLine, mergeLines, nextStamp, parseJsonl } from "./lines.ts";

const Line = LineEnvelope.extend({ text: z.string() });

const line = (id: string, at: string, dev: string, seq: number, text = "x") => ({
  id: id.padEnd(8, "-"),
  at,
  dev,
  seq,
  text,
});

describe("reading JSONL", () => {
  it("reads back what it writes", () => {
    const a = line("a", "2026-11-17T01:00:00.000Z", "dev1", 0, "first");
    const b = line("b", "2026-11-17T01:00:01.000Z", "dev1", 1, "second");
    const text = encodeLine(a) + encodeLine(b);
    expect(parseJsonl(text, Line)).toEqual({ lines: [a, b], tornTail: false, badLines: 0 });
  });

  it("skips a torn last line quietly, as after a crash mid-write", () => {
    const a = line("a", "2026-11-17T01:00:00.000Z", "dev1", 0);
    const full = encodeLine(line("b", "2026-11-17T01:00:01.000Z", "dev1", 1));
    for (let cut = 1; cut < full.length - 1; cut++) {
      const parsed = parseJsonl(encodeLine(a) + full.slice(0, cut), Line);
      expect(parsed.lines).toEqual([a]);
      expect(parsed.badLines).toBe(0);
    }
  });

  it("keeps a whole last line that only lost its newline", () => {
    const a = line("a", "2026-11-17T01:00:00.000Z", "dev1", 0);
    expect(parseJsonl(encodeLine(a).trimEnd(), Line).lines).toEqual([a]);
  });

  it("counts an unreadable line in the middle, and still reads the rest", () => {
    const a = line("a", "2026-11-17T01:00:00.000Z", "dev1", 0);
    const parsed = parseJsonl(`${encodeLine(a)}{oops\n${encodeLine(a)}`, Line);
    expect(parsed.badLines).toBe(1);
    expect(parsed.lines).toHaveLength(2);
    expect(parseJsonl(`{"id":"short"}\n`, Line).badLines).toBe(1);
  });

  it("ignores blank lines and Windows line endings", () => {
    const a = line("a", "2026-11-17T01:00:00.000Z", "dev1", 0);
    expect(parseJsonl(`\n${encodeLine(a).replace("\n", "\r\n")}\n`, Line).lines).toEqual([a]);
    expect(parseJsonl("", Line)).toEqual({ lines: [], tornTail: false, badLines: 0 });
  });
});

describe("merging devices' files", () => {
  it("orders by time, then device, then counter, counting copies once", () => {
    const a1 = line("a1", "2026-11-17T01:00:00.000Z", "devA", 0);
    const a2 = line("a2", "2026-11-17T01:00:00.000Z", "devA", 1);
    const b1 = line("b1", "2026-11-17T01:00:00.000Z", "devB", 0);
    const b2 = line("b2", "2026-11-17T00:59:59.999Z", "devB", 1);
    expect(mergeLines([b1, b2], [a2, a1], [a1])).toEqual([b2, a1, a2, b1]);
  });

  it("never loses a line, whatever the files and copies (fuzzed)", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let round = 0; round < 200; round++) {
      const devices = ["devA", "devB", "devC"];
      const all = devices.flatMap((dev) => {
        let ms = Date.UTC(2026, 10, 17);
        return Array.from({ length: Math.floor(rand() * 20) }, (_, seq) => {
          ms += Math.floor(rand() * 3) * 1000; // equal times are common
          return line(`${dev}${String(seq)}`, new Date(ms).toISOString(), dev, seq);
        });
      });
      const files = devices.map((dev) => all.filter((l) => l.dev === dev));
      const copies = files.map((f) => f.filter(() => rand() < 0.3)); // sync conflict copies
      const shuffled = [...files, ...copies].sort(() => rand() - 0.5);
      const merged = mergeLines(...shuffled);
      expect(new Set(merged.map((l) => l.id)).size).toBe(all.length);
      expect(merged).toHaveLength(all.length);
      expect(merged).toEqual(mergeLines(all));
    }
  });
});

describe("stamping", () => {
  it("starts at zero and never steps back in time", () => {
    const first = nextStamp(null, Date.UTC(2026, 10, 17, 1));
    expect(first).toEqual({ at: "2026-11-17T01:00:00.000Z", seq: 0 });
    const earlier = nextStamp(first, Date.UTC(2026, 10, 17, 0));
    expect(earlier).toEqual({ at: "2026-11-17T01:00:00.000Z", seq: 1 });
  });
});
