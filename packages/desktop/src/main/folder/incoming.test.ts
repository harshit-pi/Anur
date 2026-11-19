import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { docFromText, nameFromText, obsidianVaults, resolveIncoming } from "./incoming.ts";

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "anur-incoming-"));
  const vault = path.join(root, "Startup Ideas");
  const other = path.join(root, "Work");
  mkdirSync(path.join(vault, "Ideas"), { recursive: true });
  mkdirSync(other);
  writeFileSync(path.join(vault, "Ideas", "Tutor.md"), "# Tutor\n");
  writeFileSync(path.join(other, "Plan.md"), "# Plan\n");
  const appData = path.join(root, "AppSupport");
  mkdirSync(path.join(appData, "obsidian"), { recursive: true });
  writeFileSync(
    path.join(appData, "obsidian", "obsidian.json"),
    JSON.stringify({
      vaults: { a: { path: other, ts: 1 }, b: { path: vault, ts: 2, open: true } },
    }),
  );
  return { root, vault, other, appData };
}
const none = { uriList: "", text: "", obsidianFiles: "" };

describe("what another app drops or pastes", () => {
  it("reads Obsidian's vault list", async () => {
    const s = setup();
    expect(await obsidianVaults(s.appData)).toEqual([
      { name: "Work", path: s.other, open: false },
      { name: "Startup Ideas", path: s.vault, open: true },
    ]);
    expect(await obsidianVaults(path.join(s.root, "nowhere"))).toEqual([]);
  });

  it("finds the note an Obsidian drag links, with or without its .md", async () => {
    const s = setup();
    const vaults = await obsidianVaults(s.appData);
    const link = "obsidian://open?vault=Startup%20Ideas&file=Ideas%2FTutor";
    expect(await resolveIncoming({ ...none, uriList: link, text: link }, vaults)).toEqual({
      paths: [path.join(s.vault, "Ideas", "Tutor.md")],
      text: null,
    });
    // A vault this Mac doesn't have: the link stays text.
    const away = "obsidian://open?vault=Gone&file=Tutor";
    expect((await resolveIncoming({ ...none, uriList: away, text: away }, vaults)).paths).toEqual(
      [],
    );
  });

  it("finds Obsidian's copied notes in the open vault first", async () => {
    const s = setup();
    const vaults = await obsidianVaults(s.appData);
    const obsidianFiles = JSON.stringify({
      operation: "copy",
      paths: ["Ideas/Tutor.md", "Plan.md"],
    });
    expect((await resolveIncoming({ ...none, obsidianFiles }, vaults)).paths).toEqual([
      path.join(s.vault, "Ideas", "Tutor.md"),
      path.join(s.other, "Plan.md"),
    ]);
  });

  it("takes file addresses and plain paths, and keeps anything else as text", async () => {
    const s = setup();
    const file = path.join(s.other, "Plan.md");
    expect(
      (await resolveIncoming({ ...none, uriList: pathToFileURL(file).href }, [])).paths,
    ).toEqual([file]);
    expect((await resolveIncoming({ ...none, text: file }, [])).paths).toEqual([file]);
    expect(await resolveIncoming({ ...none, text: "Ideas for the launch\nMore." }, [])).toEqual({
      paths: [],
      text: "Ideas for the launch\nMore.",
    });
    expect((await resolveIncoming(none, [])).text).toBe(null);
  });

  it("names a doc from the text's first line and never writes over one", async () => {
    expect(nameFromText("## Launch: the plan\nbody")).toBe("Launch the plan");
    expect(nameFromText("https://example.com/post")).toBe("example.com post");
    expect(nameFromText("   \n")).toBe("Pasted text");
    const dir = mkdtempSync(path.join(tmpdir(), "anur-text-"));
    expect(await docFromText(dir, "Notes from Slack")).toBe("Notes from Slack.md");
    expect(await docFromText(dir, "Notes from Slack")).toBe("Notes from Slack 2.md");
    expect(readFileSync(path.join(dir, "Notes from Slack.md"), "utf8")).toBe("Notes from Slack\n");
  });
});

describe("a folder dragged from Obsidian, which gives only its name", () => {
  const none = { uriList: "", obsidianFiles: "" };
  function vault(name: string, open: boolean) {
    const root = mkdtempSync(path.join(tmpdir(), "vault-"));
    return { name, path: root, open };
  }

  it("copies the one folder by that name", async () => {
    const v = vault("Work", true);
    mkdirSync(path.join(v.path, "Mocks", "Actions"), { recursive: true });
    const r = await resolveIncoming({ ...none, text: "Actions" }, [v]);
    expect(r).toEqual({ paths: [path.join(v.path, "Mocks", "Actions")], text: null });
  });

  it("asks for a copy when several folders share the name", async () => {
    const v = vault("Work", true);
    mkdirSync(path.join(v.path, "A", "Actions"), { recursive: true });
    mkdirSync(path.join(v.path, "B", "Actions"), { recursive: true });
    const r = await resolveIncoming({ ...none, text: "Actions" }, [v]);
    expect(r.paths).toEqual([]);
    expect(r.reason).toMatch(/2 folders are called "Actions"/);
  });

  it("keeps text that names no folder as text", async () => {
    const v = vault("Work", true);
    mkdirSync(path.join(v.path, "Mocks"), { recursive: true });
    const r = await resolveIncoming({ ...none, text: "Buy milk" }, [v]);
    expect(r).toEqual({ paths: [], text: "Buy milk" });
  });
});
