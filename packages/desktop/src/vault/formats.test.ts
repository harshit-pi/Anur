// Every .anur/ line format, written by the real writer and read back from disk.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PreviewFile, ThreadLine, anurPaths, encodePreviewFile } from "@anur/core";
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "./anur-folder.ts";
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

  it("round-trips a preview file, its base included, at its own path", async () => {
    const preview = PreviewFile.parse({
      id: "p1",
      thread: "t1",
      changeSet: "cs1",
      at: "2026-11-17T01:00:00.000Z",
      dev: "dev1",
      summary: "Shorter retries",
      kind: "edit",
      doc: "d1",
      newDocPath: null,
      parts: [
        {
          section: "s1",
          path: ["T", "Retry"],
          base: "## Retry\n\nOld.\n",
          proposed: "## Retry\n\nNew.\n",
        },
      ],
    });
    const file = path.join(dir, ".anur", anurPaths.preview("d1", "dev1", "p1"));
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(path.dirname(file), { recursive: true }),
    );
    await writeFileAtomic(file, encodePreviewFile(preview));
    expect(PreviewFile.parse(JSON.parse(await readFile(file, "utf8")))).toEqual(preview);
  });
});
