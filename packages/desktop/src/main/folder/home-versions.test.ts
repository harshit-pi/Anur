import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HomeVersions } from "./home-versions.ts";

const DOC = "# Plan\n\nIntro.\n\n## Risks\n\nThe host is untested.\n";
const README = "# Api\n\nHow to run it.\n\n## Setup\n\nnpm install\n";

/** A workspace: notes at its root, two repos each with a README, and a docs folder in one. */
function workspace() {
  const ws = mkdtempSync(path.join(tmpdir(), "anur-homev-"));
  for (const r of ["api", "web"]) {
    mkdirSync(path.join(ws, r));
    execFileSync("git", ["-C", path.join(ws, r), "init", "-q"]);
    writeFileSync(path.join(ws, r, "README.md"), README);
  }
  mkdirSync(path.join(ws, "notes"));
  writeFileSync(path.join(ws, "notes", "plan.md"), DOC);
  writeFileSync(path.join(ws, "plan.md"), DOC);
  return ws;
}
const docsIn = (dir: string) =>
  existsSync(path.join(dir, ".anur", "docs")) ? readdirSync(path.join(dir, ".anur", "docs")) : [];

describe("section IDs and history in each doc's home (18.15.2)", () => {
  it("keeps a repo doc's IDs in the repo's .anur/, and a loose doc's in the folder's", async () => {
    const ws = workspace();
    const v = new HomeVersions(ws, "dev1");
    const api = await v.locate("api/README.md", README);
    const loose = await v.locate("notes/plan.md", DOC);
    expect(api && loose).toBeTruthy();
    expect(docsIn(path.join(ws, "api"))).toEqual([api?.doc]);
    expect(docsIn(ws)).toEqual([loose?.doc]);
    expect(v.anurDirOf(api?.doc ?? ("" as never))).toBe(path.join(ws, "api", ".anur"));
    expect(v.anurDirOf(loose?.doc ?? ("" as never))).toBe(path.join(ws, ".anur"));
    // Nothing is made in a repo nobody opened a doc in.
    expect(existsSync(path.join(ws, "web", ".anur"))).toBe(false);
  });

  it("gives a repo doc the same doc and section IDs whether the repo or the workspace is opened", async () => {
    const ws = workspace();
    const fromWorkspace = await new HomeVersions(ws, "dev1").locate("api/README.md", README);
    const fromRepo = await new HomeVersions(path.join(ws, "api"), "dev1").locate(
      "README.md",
      README,
    );
    expect(fromRepo?.doc).toBe(fromWorkspace?.doc);
    expect(fromRepo?.ids).toEqual(fromWorkspace?.ids);
    // And on another device, later: the same, from what the repo holds.
    const again = await new HomeVersions(ws, "dev2").locate("api/README.md", README);
    expect(again?.doc).toBe(fromWorkspace?.doc);
    expect(again?.ids).toEqual(fromWorkspace?.ids);
  });

  it("never gives two repos' docs at the same path the same ID", async () => {
    const ws = workspace();
    const v = new HomeVersions(ws, "dev1");
    const a = await v.locate("api/README.md", README);
    const b = await v.locate("web/README.md", README);
    expect(a?.doc).not.toBe(b?.doc);
    expect(a?.ids.some((id) => b?.ids.includes(id))).toBe(false);
  });

  it("makes each home's ID once, committed, with the ignore file that keeps searches out", async () => {
    const ws = workspace();
    const v = new HomeVersions(ws, "dev1");
    await v.locate("api/README.md", README);
    const id = readFileSync(path.join(ws, "api", ".anur", "home-id"), "utf8").trim();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(readFileSync(path.join(ws, "api", ".anur", ".ignore"), "utf8")).toBe("*\n");
    await new HomeVersions(path.join(ws, "api"), "dev2").locate("README.md", README);
    expect(readFileSync(path.join(ws, "api", ".anur", "home-id"), "utf8").trim()).toBe(id);
  });

  it("writes history into the repo, readable from the workspace and from the repo alone", async () => {
    const ws = workspace();
    const v = new HomeVersions(ws, "dev1");
    await v.opened("api/README.md", README);
    await v.endAll();
    const fromWs = await v.list("api/README.md", README, ["Api", "Setup"]);
    expect(fromWs.length).toBeGreaterThan(0);
    expect(existsSync(path.join(ws, ".anur", "docs"))).toBe(false);
    const fromRepo = await new HomeVersions(path.join(ws, "api"), "dev1").list(
      "README.md",
      README,
      ["Api", "Setup"],
    );
    expect(fromRepo.map((x) => x.id)).toEqual(fromWs.map((x) => x.id));
  });

  it("keeps a doc's ID through a move within its home, and starts afresh in another home", async () => {
    const ws = workspace();
    const v = new HomeVersions(ws, "dev1");
    const before = await v.locate("api/README.md", README);
    mkdirSync(path.join(ws, "api", "docs"));
    await v.moved([{ from: "api/README.md", to: "api/docs/README.md" }]);
    const within = await v.locate("api/docs/README.md", README);
    expect(within?.doc).toBe(before?.doc);
    await v.moved([{ from: "api/docs/README.md", to: "web/OLD.md" }]);
    const across = await v.locate("web/OLD.md", README);
    expect(across?.doc).not.toBe(before?.doc);
    expect(v.anurDirOf(across?.doc ?? ("" as never))).toBe(path.join(ws, "web", ".anur"));
  });

  it("finds a repo cloned in after opening, once asked to look again", async () => {
    const ws = workspace();
    const v = new HomeVersions(ws, "dev1");
    await v.locate("plan.md", DOC);
    mkdirSync(path.join(ws, "svc"));
    execFileSync("git", ["-C", path.join(ws, "svc"), "init", "-q"]);
    writeFileSync(path.join(ws, "svc", "README.md"), README);
    await v.refresh();
    await v.locate("svc/README.md", README);
    expect(docsIn(path.join(ws, "svc"))).toHaveLength(1);
    expect(await v.anurDirs()).toEqual(
      ["", "api", "svc", "web"].map((h) => path.join(ws, h, ".anur")),
    );
  });

  it("puts a docs folder that has its own .anur/ inside a repo in its own home", async () => {
    const ws = workspace();
    mkdirSync(path.join(ws, "api", "design", ".anur"), { recursive: true });
    writeFileSync(path.join(ws, "api", "design", "a.md"), DOC);
    const v = new HomeVersions(ws, "dev1");
    const a = await v.locate("api/design/a.md", DOC);
    expect(v.anurDirOf(a?.doc ?? ("" as never))).toBe(path.join(ws, "api", "design", ".anur"));
    expect(v.homeOfDoc("api/design/a.md")).toBe("api/design");
    expect(v.homeOfDoc("api/README.md")).toBe("api");
    expect(v.homeOfDoc("notes/plan.md")).toBe("");
  });
});
