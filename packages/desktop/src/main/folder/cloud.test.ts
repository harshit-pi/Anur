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
import { NotDownloaded, readDocText, type ReadDeps } from "../../vault/icloud.ts";
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

describe("reading a doc iCloud has offloaded", () => {
  const fake = (over: Partial<ReadDeps>): ReadDeps => ({
    isDataless: () => Promise.resolve(false),
    download: () => Promise.resolve(),
    read: () => Promise.resolve("# Doc\n"),
    size: () => Promise.resolve(6),
    ...over,
  });

  it("downloads it first, then reads its text", async () => {
    let inCloud = true;
    const text = await readDocText(
      "/v/Doc.md",
      fake({
        isDataless: () => Promise.resolve(inCloud),
        download: () => {
          inCloud = false;
          return Promise.resolve();
        },
        read: () => Promise.resolve(inCloud ? "" : "# Doc\n"),
      }),
    );
    expect(text).toBe("# Doc\n");
  });

  it("never takes a read that comes back empty for an empty doc", async () => {
    await expect(
      readDocText("/v/Doc.md", fake({ read: () => Promise.resolve("") })),
    ).rejects.toBeInstanceOf(NotDownloaded);
  });

  it("says so when iCloud can't send it", async () => {
    await expect(
      readDocText(
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
      await readDocText(
        "/v/Empty.md",
        fake({ read: () => Promise.resolve(""), size: () => Promise.resolve(0) }),
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

  it("only merges copies the folder listed", async () => {
    const folder = await opened();
    expect(await planConflict(folder, "../outside.md")).toMatchObject({ kind: "failed" });
    expect(await planConflict(folder, "Retry.md")).toMatchObject({ kind: "failed" });
  });
});
