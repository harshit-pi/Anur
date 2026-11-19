import { mkdir, mkdtemp, open, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { anurWritten, copyOf, keepAnurCopiesIn, readFile } from "./anur-copy.ts";

/** Stand in for iCloud offloading a file: same size and time, no blocks on disk. */
async function offload(file: string): Promise<void> {
  const s = await stat(file);
  await rm(file);
  const f = await open(file, "w");
  await f.truncate(s.size);
  await f.close();
  await utimes(file, s.atime, s.mtime);
}

const settle = () => new Promise((r) => setTimeout(r, 100));

describe("local copies of .anur files", () => {
  afterEach(() => {
    keepAnurCopiesIn(null);
  });

  async function setup() {
    const base = await mkdtemp(path.join(tmpdir(), "anur-copy-"));
    keepAnurCopiesIn(path.join(base, "copies"));
    const dir = path.join(base, "Library", "Mobile Documents", "Vault", ".anur", "docs");
    await mkdir(dir, { recursive: true });
    return { base, file: path.join(dir, "a.jsonl") };
  }

  it("reads an offloaded file from its copy", async () => {
    const { file } = await setup();
    await writeFile(file, '{"line":1}\n');
    anurWritten(file);
    await settle();
    await offload(file);
    expect((await stat(file)).blocks).toBe(0);
    expect(await readFile(file, "utf8")).toBe('{"line":1}\n');
  });

  it("reads the file itself once it changed, as when another device wrote it", async () => {
    const { file } = await setup();
    await writeFile(file, '{"line":1}\n');
    expect(await readFile(file, "utf8")).toBe('{"line":1}\n');
    await settle();
    await writeFile(file, '{"line":2}\n');
    await utimes(file, new Date(), new Date(Date.now() + 5000));
    await offload(file);
    // Not the copy: what the file holds (here the stand-in's zeros).
    expect(await readFile(file, "utf8")).not.toBe('{"line":1}\n');
  });

  it("keeps no copies outside iCloud folders or outside .anur", async () => {
    const { base } = await setup();
    expect(copyOf(path.join(base, "elsewhere", ".anur", "a.jsonl"))).toBeNull();
    expect(copyOf(path.join(base, "Library", "Mobile Documents", "Vault", "note.md"))).toBeNull();
  });
});
