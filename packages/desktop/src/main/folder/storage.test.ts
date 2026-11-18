import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  devicesStillOpen,
  namesOf,
  noteName,
  noteOpened,
  noteQuit,
  storageOf,
  unusedAttachments,
  unusedSnapshots,
} from "./storage.ts";

async function folder(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), "anur-storage-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), text);
  }
  return dir;
}

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

describe("open notes (11.4)", () => {
  it("counts a device open until it quits cleanly", async () => {
    const dir = await folder({});
    await noteOpened(dir, "one");
    await noteOpened(dir, "two");
    expect((await devicesStillOpen(dir, "one")).map((d) => d.device)).toEqual(["two"]);
    await noteQuit(dir, "two");
    expect(await devicesStillOpen(dir, "one")).toEqual([]);
    // Opened again after its last clean quit: open, or it crashed.
    await noteOpened(dir, "two");
    expect(await devicesStillOpen(dir, "one")).toHaveLength(1);
    // Gone for over 30 days without a clean quit: it no longer holds Clean up off.
    await noteOpened(dir, "two", old);
    expect(await devicesStillOpen(dir, "one")).toEqual([]);
  });
});

describe("names on threads", () => {
  it("reads each device's person from its note, and follows a rename", async () => {
    const dir = await folder({});
    await noteOpened(dir, "one", new Date(), "Duy");
    await noteOpened(dir, "two");
    expect([...(await namesOf(dir))]).toEqual([["one", "Duy"]]);
    await noteName(dir, "one", "Duy N");
    await noteQuit(dir, "one");
    expect((await namesOf(dir)).get("one")).toBe("Duy N");
  });
});

describe("storage and Clean up (11.5)", () => {
  it("sizes .anur by kind, and finds only old snapshots nothing names", async () => {
    const dir = await folder({
      ".anur/docs/d1/threads/t1/dev.jsonl": `{"kind":"input","hash":"${A}"}\n`,
      ".anur/docs/d1/history/s1/dev.jsonl": "{}\n",
      ".anur/docs/d1/someday/dev.jsonl": `{"kind":"new-kind","x":"${C}"}\n`,
      [`.anur/snapshots/${A}`]: "used",
      [`.anur/snapshots/${B}`]: "unused",
      [`.anur/snapshots/${C}`]: "named by an unknown record",
    });
    for (const h of [A, B, C]) await utimes(path.join(dir, ".anur/snapshots", h), old, old);
    const kinds = await storageOf(dir);
    expect(kinds.map((k) => k.kind)).toEqual(["threads", "history", "snapshots", "other"]);
    expect(kinds.find((k) => k.kind === "snapshots")?.files).toBe(3);
    expect((await unusedSnapshots(dir)).map((s) => s.hash)).toEqual([B]);
  });

  it("keeps a recent snapshot, even unnamed", async () => {
    const dir = await folder({ [`.anur/snapshots/${B}`]: "new" });
    expect(await unusedSnapshots(dir)).toEqual([]);
  });
});

describe("unused attachments (11.6)", () => {
  it("lists images and attachments nothing links or uses", async () => {
    const dir = await folder({
      "Plan.md": "![[used.png]] and [doc](spec.pdf)",
      "used.png": "x",
      "lonely.png": "x",
      "spec.pdf": "x",
      "attached.pdf": "x",
      "dropped.pdf": "x",
      "data.csv": "x",
      ".anur/docs/d1/inputs/dev.jsonl":
        '{"kind":"added-input","id":"i1","source":"attachment","ref":"attached.pdf"}\n' +
        '{"kind":"added-input","id":"i2","source":"attachment","ref":"dropped.pdf"}\n' +
        '{"kind":"input-removed","id":"r1","input":"i2"}\n',
    });
    const files = ["used.png", "lonely.png", "spec.pdf", "attached.pdf", "dropped.pdf", "data.csv"];
    const out = await unusedAttachments(dir, ["Plan.md"], files);
    expect(out.map((f) => f.path)).toEqual(["lonely.png", "dropped.pdf"]);
  });
});
