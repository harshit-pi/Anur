import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotDownloaded, readDocBytes, type ReadDeps } from "../../vault/icloud.ts";
import { settleConflicts, type SettleDeps } from "./conflicts.ts";
import { FolderService } from "./folder-service.ts";

let home: string;
let vault: string;
let appSupport: string;
beforeEach(() => {
  home = realpathSync(mkdtempSync(path.join(tmpdir(), "anur-cloud-")));
  vault = path.join(
    home,
    "Library",
    "Mobile Documents",
    "iCloud~md~obsidian",
    "Documents",
    "Tally",
  );
  appSupport = path.join(home, "AppSupport");
  mkdirSync(vault, { recursive: true });
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const write = (rel: string, text: string) => {
  const p = path.join(vault, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
};

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("reading a doc iCloud has offloaded", () => {
  const fake = (over: Partial<ReadDeps>): ReadDeps => ({
    isDataless: () => Promise.resolve(false),
    download: () => Promise.resolve(),
    read: () => Promise.resolve(bytes("# Doc\n")),
    size: () => Promise.resolve(6),
    ...over,
  });

  it("downloads it first, then reads its text", async () => {
    let inCloud = true;
    const got = await readDocBytes(
      "/v/Doc.md",
      fake({
        isDataless: () => Promise.resolve(inCloud),
        download: () => {
          inCloud = false;
          return Promise.resolve();
        },
        read: () => Promise.resolve(bytes(inCloud ? "" : "# Doc\n")),
      }),
    );
    expect(text(got)).toBe("# Doc\n");
  });

  it("never takes a read that comes back empty for an empty doc", async () => {
    await expect(
      readDocBytes("/v/Doc.md", fake({ read: () => Promise.resolve(bytes("")) })),
    ).rejects.toBeInstanceOf(NotDownloaded);
  });

  it("says so when iCloud can't send it", async () => {
    await expect(
      readDocBytes(
        "/v/Doc.md",
        fake({
          isDataless: () => Promise.resolve(true),
          download: () => Promise.reject(new Error("offline")),
        }),
      ),
    ).rejects.toThrow(/couldn't be downloaded: offline/);
  });

  it("reads a doc that really is empty", async () => {
    expect(
      text(
        await readDocBytes(
          "/v/Empty.md",
          fake({ read: () => Promise.resolve(bytes("")), size: () => Promise.resolve(0) }),
        ),
      ),
    ).toBe("");
  });
});

describe("a folder in iCloud", () => {
  it("is named as such, with git inside it flagged and conflict copies found", async () => {
    write("Notes.md", "# Notes\n");
    write("Notes 2.md", "# Notes\n");
    mkdirSync(path.join(vault, ".git"));
    const r = await new FolderService(appSupport, home).open(1, vault);
    expect(r).toMatchObject({
      kind: "opened",
      folder: {
        cloud: "icloud",
        gitInCloud: true,
        folders: [],
        files: [],
        times: {},
        conflicts: [{ original: "Notes.md", copy: "Notes 2.md", service: "icloud" }],
      },
    });
  });

  it("isn't, when it lives elsewhere", async () => {
    const local = path.join(home, "workspace", "Tally");
    mkdirSync(local, { recursive: true });
    const r = await new FolderService(appSupport, home).open(1, local);
    expect(r).toMatchObject({
      kind: "opened",
      folder: { cloud: null, gitInCloud: false, offloaded: [] },
    });
  });
});

describe("a conflict copy, settled quietly on disk", () => {
  async function settle(files: Record<string, string | Buffer>, deps: Partial<SettleDeps> = {}) {
    for (const [rel, text] of Object.entries(files)) writeFileSync(path.join(vault, rel), text);
    const r = await new FolderService(appSupport, home).open(1, vault);
    if (r.kind !== "opened") throw new Error("expected the folder to open");
    const trashed: string[] = [];
    const logged: string[] = [];
    const changed = await settleConflicts(r.folder, {
      history: () => Promise.resolve([]),
      known: () => Promise.resolve(false),
      trash: (f) => {
        trashed.push(path.relative(vault, f));
        rmSync(f);
        return Promise.resolve();
      },
      log: (m) => logged.push(m),
      ...deps,
    });
    const read = (rel: string) => readFileSync(path.join(vault, rel), "utf8");
    return { changed, trashed, logged, read };
  }

  it("trashes a copy that's the same", async () => {
    const r = await settle({ "Notes.md": "# Notes\n\nHi.\n", "Notes 2.md": "# Notes\n\nHi.  \n" });
    expect(r).toMatchObject({ changed: true, trashed: ["Notes 2.md"] });
    expect(r.read("Notes.md")).toBe("# Notes\n\nHi.\n");
  });

  it("keeps the fuller one, in the original's own line endings", async () => {
    const r = await settle({
      "Crlf.md": "# Retry\r\n\r\n## Timing\r\n\r\nOne hour.\r\n",
      "Crlf 2.md": "# Retry\n\n## Timing\n\nOne hour.\nThen a day.\n",
    });
    expect(r.trashed).toEqual(["Crlf 2.md"]);
    expect(r.read("Crlf.md")).toBe("# Retry\r\n\r\n## Timing\r\n\r\nOne hour.\r\nThen a day.\r\n");
    expect(r.logged[0]).toMatch(/folded Crlf 2.md into Crlf.md/);
  });

  it("leaves both when they differ, when Anur knows the copy, or when it isn't UTF-8", async () => {
    const r = await settle(
      {
        "Retry.md": "# Retry\n\n## Timing\n\nOne hour.\n",
        "Retry 2.md": "# Retry\n\n## Timing\n\nThirty minutes.\n",
        "Kept.md": "# Kept\n",
        "Kept 2.md": "# Kept\n",
        "Latin.md": Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0a]),
        "Latin 2.md": Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x21, 0x0a]),
      },
      { known: (rel) => Promise.resolve(rel === "Kept 2.md") },
    );
    expect(r).toMatchObject({ changed: false, trashed: [] });
    expect(r.read("Retry.md")).toBe("# Retry\n\n## Timing\n\nOne hour.\n");
    expect(r.logged).toEqual([expect.stringMatching(/kept Retry 2.md beside Retry.md/) as unknown]);
  });
});
