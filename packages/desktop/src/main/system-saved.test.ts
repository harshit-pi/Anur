import { mkdtemp, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FolderRead } from "./index-process/protocol.ts";
import { loadRead, saveRead } from "./system-saved.ts";

const read = { sources: [], edges: [] } as unknown as FolderRead;

describe("the saved read of a folder's system", () => {
  it("comes back for the same plugins, leaving no temp file", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "anur-saved-"));
    await saveRead(folder, "engineering", read);
    expect(await loadRead(folder, "engineering")).toEqual(read);
    expect(await readdir(path.join(folder, ".anur", "system"))).toEqual(["last-read.json"]);
  });

  it("is nothing for other plugins, an older shape, or no file", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "anur-saved-"));
    expect(await loadRead(folder, "engineering")).toBeNull();
    await saveRead(folder, "engineering", read);
    expect(await loadRead(folder, "engineering,git")).toBeNull();
    await mkdir(path.join(folder, ".anur", "system"), { recursive: true });
    await writeFile(
      path.join(folder, ".anur", "system", "last-read.json"),
      JSON.stringify({ version: 0, plugins: "engineering", read }),
    );
    expect(await loadRead(folder, "engineering")).toBeNull();
  });
});
