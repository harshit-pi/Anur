import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotDownloaded, readDocBytes, type ReadDeps } from "../../vault/icloud.ts";
import { mergeConflict, planConflict } from "./conflicts.ts";
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

describe("merging a conflict copy on disk", () => {
  const ORIGINAL = "# Retry\n\n## Timing\n\nOne hour.\n";
  const COPY = "# Retry\n\n## Timing\n\nThirty minutes.\n\n## Channel\n\nEmail first.\n";

  async function opened() {
    write("Retry.md", ORIGINAL);
    write("Retry 2.md", COPY);
    const r = await new FolderService(appSupport, home).open(1, vault);
    if (r.kind !== "opened") throw new Error("expected the folder to open");
    return r.folder;
  }

  it("writes the picked sections into the original and moves the copy to the Trash", async () => {
    const folder = await opened();
    const plan = await planConflict(folder, "Retry 2.md");
    if (plan.kind !== "plan") throw new Error(plan.reason);
    const trashed: string[] = [];
    const result = await mergeConflict(
      folder,
      { copy: "Retry 2.md", hashes: plan.hashes, choices: { "1": "copy" } },
      (f) => {
        trashed.push(f);
        return Promise.resolve();
      },
    );
    expect(result).toEqual({ ok: true });
    expect(readFileSync(path.join(vault, "Retry.md"), "utf8")).toBe(COPY);
    expect(trashed).toEqual([path.join(vault, "Retry 2.md")]);
  });

  it("refuses when a file changed after the plan, and touches nothing", async () => {
    const folder = await opened();
    const plan = await planConflict(folder, "Retry 2.md");
    if (plan.kind !== "plan") throw new Error(plan.reason);
    write("Retry.md", `${ORIGINAL}\nTyped after the plan.\n`);
    const result = await mergeConflict(
      folder,
      { copy: "Retry 2.md", hashes: plan.hashes, choices: {} },
      () => Promise.resolve(),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/changed since/) as unknown,
    });
    expect(readFileSync(path.join(vault, "Retry.md"), "utf8")).toContain("Typed after the plan.");
    expect(existsSync(path.join(vault, "Retry 2.md"))).toBe(true);
  });

  it("keeps a Windows-ending original Windows-ending, and refuses a file that isn't UTF-8", async () => {
    write("Crlf.md", "# Retry\r\n\r\n## Timing\r\n\r\nOne hour.\r\n");
    write("Crlf 2.md", "# Retry\r\n\r\n## Timing\r\n\r\nThirty minutes.\r\n");
    writeFileSync(
      path.join(vault, "Latin.md"),
      Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x0a]),
    );
    writeFileSync(
      path.join(vault, "Latin 2.md"),
      Buffer.from([0x23, 0x20, 0x43, 0x61, 0x66, 0xe9, 0x21, 0x0a]),
    );
    const r = await new FolderService(appSupport, home).open(1, vault);
    if (r.kind !== "opened") throw new Error("expected the folder to open");
    const plan = await planConflict(r.folder, "Crlf 2.md");
    if (plan.kind !== "plan") throw new Error(plan.reason);
    await mergeConflict(
      r.folder,
      { copy: "Crlf 2.md", hashes: plan.hashes, choices: { "1": "copy" } },
      () => Promise.resolve(),
    );
    expect(readFileSync(path.join(vault, "Crlf.md"), "utf8")).toBe(
      "# Retry\r\n\r\n## Timing\r\n\r\nThirty minutes.\r\n",
    );
    expect(await planConflict(r.folder, "Latin 2.md")).toMatchObject({
      kind: "failed",
      reason: expect.stringMatching(/isn't UTF-8/) as unknown,
    });
  });

  it("only merges copies the folder listed", async () => {
    const folder = await opened();
    expect(await planConflict(folder, "../outside.md")).toMatchObject({ kind: "failed" });
    expect(await planConflict(folder, "Retry.md")).toMatchObject({ kind: "failed" });
  });
});
