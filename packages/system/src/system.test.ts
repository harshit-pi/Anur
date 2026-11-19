import { mkdtempSync, readFileSync, renameSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystem, git, makeRepo, twoRepoSystem } from "./fixtures.ts";
import { findRepos } from "./repos.ts";
import { scanSystem } from "./system.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "anur-system-"));
const idOf = (scan: ReturnType<typeof scanSystem>, name: string) =>
  scan.parts.find((p) => p.name === name)?.id;

describe("scanSystem: repos and parts (group 20)", () => {
  it("lists every repo and every part of the two-repo fixture, by rule", () => {
    const dir = tmp();
    const want = twoRepoSystem(dir);
    const scan = scanSystem(dir);
    expect(scan.repos.map((r) => r.dir)).toEqual(want.repos);
    expect(scan.repos.map((r) => r.github)).toEqual(["acme/api", "acme/web"]);
    expect(scan.parts.map((p) => ({ repo: p.repo, kind: p.kind, name: p.name }))).toEqual(
      want.parts,
    );
    expect(scan.problems).toEqual([]);
  });

  it("gets at least 90% of the four-repo fixture's parts right by rule, within 15 s", () => {
    const dir = tmp();
    const want = generateSystem(dir, { repos: 4, packagesPerRepo: 3, filesPerPackage: 20 });
    const t0 = Date.now();
    const scan = scanSystem(dir);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(scan.repos.map((r) => r.dir)).toEqual(want.repos);
    const got = new Set(scan.parts.map((p) => `${p.repo}|${p.kind}|${p.name}`));
    const right = want.parts.filter((p) => got.has(`${p.repo}|${p.kind}|${p.name}`)).length;
    expect(right / want.parts.length).toBeGreaterThanOrEqual(0.9);
    // Nothing found that isn't there, and a repo without a remote still has its parts.
    expect(scan.parts.length).toBe(want.parts.length);
    expect(scan.parts.some((p) => p.repo === "repo-01" && p.kind === "stack")).toBe(true);
  });

  it("updates in under a second after a change, on the four-repo fixture", () => {
    const dir = tmp();
    generateSystem(dir, { repos: 4, packagesPerRepo: 3, filesPerPackage: 20 });
    const first = scanSystem(dir);
    writeFileSync(
      path.join(dir, "repo-02", "package.json"),
      JSON.stringify({ name: "@sys/renamed" }),
    );
    const t0 = Date.now();
    scanSystem(dir, { known: first.known });
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});

describe("part IDs survive change (Internals §1)", () => {
  it("keeps an ID through a rename in the same build file, writing a rename line", () => {
    const dir = tmp();
    twoRepoSystem(dir);
    const before = scanSystem(dir);
    writeFileSync(path.join(dir, "web", "package.json"), JSON.stringify({ name: "@acme/website" }));
    const after = scanSystem(dir, { known: before.known });
    expect(idOf(after, "@acme/website")).toBe(idOf(before, "@acme/web"));
    expect(after.lines).toContainEqual(
      expect.objectContaining({ kind: "rename", from: "@acme/web", to: "@acme/website" }),
    );
  });

  it("keeps an ID when the build file moves within the repo", () => {
    const dir = tmp();
    twoRepoSystem(dir);
    const before = scanSystem(dir);
    mkdirSync(path.join(dir, "api", "service"));
    renameSync(
      path.join(dir, "api", "package.json"),
      path.join(dir, "api", "service", "package.json"),
    );
    const after = scanSystem(dir, { known: before.known });
    expect(idOf(after, "@acme/api")).toBe(idOf(before, "@acme/api"));
    expect(after.lines.filter((l) => l.kind === "orphaned")).toEqual([]);
  });

  it("keeps every ID when a repo gets a remote", () => {
    const dir = tmp();
    generateSystem(dir, { repos: 2, packagesPerRepo: 1, filesPerPackage: 1 });
    const before = scanSystem(dir);
    git(path.join(dir, "repo-01"), "remote", "add", "origin", "git@github.com:sys/repo-01.git");
    const after = scanSystem(dir, { known: before.known });
    expect(after.parts.map((p) => p.id)).toEqual(before.parts.map((p) => p.id));
  });

  it("gives a depth-1 clone the same part IDs, through the committed anur/repo.json", () => {
    const dir = tmp();
    const origin = path.join(dir, "origin");
    makeRepo(origin, { "package.json": JSON.stringify({ name: "@acme/app" }) }, null);
    // Pin the ID from the full history, then commit it, and one more change.
    const full = scanSystem(origin, { pin: true });
    expect(JSON.parse(readFileSync(path.join(origin, "anur", "repo.json"), "utf8"))).toEqual({
      id: full.repos[0]?.id,
    });
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "-m", "Pin the repo ID");
    writeFileSync(path.join(origin, "README.md"), "More.\n");
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "-m", "Second");
    const shallow = path.join(dir, "shallow");
    git(dir, "clone", "-q", "--depth", "1", `file://${origin}`, shallow);
    const clone = scanSystem(shallow);
    expect(clone.problems).toEqual([]);
    expect(idOf(clone, "@acme/app")).toBe(idOf(full, "@acme/app"));
  });
});

describe("a second clone of a repo", () => {
  it("is named as a copy of the folder the map reads, the one named as on GitHub", () => {
    const dir = tmp();
    makeRepo(
      path.join(dir, "PiTrade"),
      { "package.json": "{}" },
      "https://github.com/acme/PiTrade.git",
    );
    git(dir, "clone", "-q", path.join(dir, "PiTrade"), path.join(dir, "search-analytics"));
    git(
      path.join(dir, "search-analytics"),
      "remote",
      "set-url",
      "origin",
      "https://github.com/acme/PiTrade.git",
    );
    const found = findRepos(dir);
    expect(found.repos.map((r) => r.dir)).toEqual(["PiTrade"]);
    expect(found.copies).toEqual([{ dir: "search-analytics", of: "PiTrade" }]);
  });
});

describe("failures are shown, never fatal (20.9)", () => {
  it("skips a build file with conflict markers or bad JSON, and lists it", () => {
    const dir = tmp();
    twoRepoSystem(dir);
    writeFileSync(
      path.join(dir, "web", "package.json"),
      '<<<<<<< HEAD\n{"name":"a"}\n=======\n{"name":"b"}\n>>>>>>> x\n',
    );
    writeFileSync(path.join(dir, "api", "package.json"), "{ not json");
    const scan = scanSystem(dir);
    expect(scan.problems.map((p) => p.where)).toEqual(["api/package.json", "web/package.json"]);
    expect(scan.parts.map((p) => p.name)).toEqual(["AcmeAlerts", "AcmeApi"]);
  });

  it("shows two clones of one repo once, with a warning", () => {
    const dir = tmp();
    twoRepoSystem(dir);
    git(dir, "clone", "-q", `file://${path.join(dir, "web")}`, "web-copy");
    const scan = scanSystem(dir);
    expect(scan.repos.map((r) => r.dir)).toEqual(["api", "web"]);
    expect(scan.problems).toEqual([
      { where: "web-copy", what: "A second clone of web; shown once" },
    ]);
  });

  it("says why a shallow clone without anur/repo.json has no IDs", () => {
    const dir = tmp();
    const origin = path.join(dir, "origin");
    makeRepo(origin, { "package.json": JSON.stringify({ name: "@acme/app" }) }, null);
    writeFileSync(path.join(origin, "README.md"), "More.\n");
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "-m", "Second");
    git(dir, "clone", "-q", "--depth", "1", `file://${origin}`, "shallow");
    const scan = scanSystem(path.join(dir, "shallow"));
    expect(scan.parts).toEqual([]);
    expect(scan.problems[0]?.what).toMatch(/shallow clone without anur\/repo\.json/);
  });
});
