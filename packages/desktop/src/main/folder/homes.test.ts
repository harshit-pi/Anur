import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findHomes, fromHome, homeOf } from "./homes.ts";

const tmp = () => mkdtempSync(path.join(tmpdir(), "anur-homes-"));
const put = (root: string, files: Record<string, string>) => {
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), t);
  }
};
const repo = (dir: string, files: Record<string, string> = {}) => {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["-C", dir, "init", "-q"]);
  put(dir, files);
};
const anur = (dir: string) => {
  mkdirSync(path.join(dir, ".anur"), { recursive: true });
};

describe("finding homes (18.15.1)", () => {
  it("lists each repo and each folder holding .anur/, never the opened folder itself", async () => {
    const ws = tmp();
    anur(ws);
    repo(path.join(ws, "api"), { "README.md": "# Api" });
    repo(path.join(ws, "web"));
    anur(path.join(ws, "docs"));
    put(ws, { "docs/plan.md": "# Plan", "notes/idea.md": "# Idea" });
    expect(await findHomes(ws)).toEqual(["api", "docs", "web"]);
  });

  it("finds a repo inside a repo, and a docs folder with .anur/ inside a repo, as homes of their own", async () => {
    const ws = tmp();
    repo(path.join(ws, "app"));
    repo(path.join(ws, "app", "vendor-lib"));
    anur(path.join(ws, "app", "docs", "design"));
    put(ws, { "app/docs/design/a.md": "# A" });
    expect(await findHomes(ws)).toEqual(["app", "app/docs/design", "app/vendor-lib"]);
  });

  it("finds repos at any depth, as a folder of folders of repos", async () => {
    const ws = tmp();
    repo(path.join(ws, "team-a", "svc-1"));
    repo(path.join(ws, "team-a", "svc-2"));
    repo(path.join(ws, "team-b", "group", "svc-3"));
    expect(await findHomes(ws)).toEqual(["team-a/svc-1", "team-a/svc-2", "team-b/group/svc-3"]);
  });

  it("skips what git ignores, node_modules, and dot-folders, with any .anur/ or repo inside them", async () => {
    const ws = tmp();
    repo(path.join(ws, "api"), { ".gitignore": "cdk.out/\nbuild\n" });
    repo(path.join(ws, "api", "cdk.out", "asset")); // ignored by the repo's .gitignore
    anur(path.join(ws, "api", "build", "x")); // ignored, without a trailing slash in the rule
    repo(path.join(ws, "api", "node_modules", "pkg")); // never walked
    repo(path.join(ws, "api", ".cache", "tool")); // a dot-folder
    repo(path.join(ws, "api", "src", "module")); // not ignored: a home
    expect(await findHomes(ws)).toEqual(["api", "api/src/module"]);
  });

  it("honours an ignore rule that names a nested path, and one in a nested .gitignore", async () => {
    const ws = tmp();
    repo(path.join(ws, "api"), { ".gitignore": "/tools/generated/\n", "lib/.gitignore": "tmp/\n" });
    repo(path.join(ws, "api", "tools", "generated", "x"));
    repo(path.join(ws, "api", "tools", "kept"));
    repo(path.join(ws, "api", "lib", "tmp", "y"));
    expect(await findHomes(ws)).toEqual(["api", "api/tools/kept"]);
  });

  it("walks a folder that isn't a repo without asking git, and a missing folder gives none", async () => {
    const ws = tmp();
    put(ws, { "a/b/c/note.md": "# Note" });
    anur(path.join(ws, "a", "b"));
    expect(await findHomes(ws)).toEqual(["a/b"]);
    expect(await findHomes(path.join(ws, "missing"))).toEqual([]);
  });

  it("opened at a repo, finds what's beneath it, as opening the workspace does", async () => {
    const ws = tmp();
    repo(path.join(ws, "api"));
    anur(path.join(ws, "api", "docs"));
    expect(await findHomes(ws)).toEqual(["api", "api/docs"]);
    expect(await findHomes(path.join(ws, "api"))).toEqual(["docs"]);
  });

  it("stops at a depth, so a deep tree never stalls", async () => {
    const ws = tmp();
    const deep = path.join(ws, ...Array.from({ length: 12 }, (_, i) => `d${String(i)}`));
    repo(deep);
    repo(path.join(ws, "d0", "d1", "near"));
    expect(await findHomes(ws)).toEqual(["d0/d1/near"]);
  });
});

describe("a doc's home (18.15.1)", () => {
  const homes = ["api", "api/docs", "api2", "team/svc"];
  it("is the deepest home above it, with the doc's path from there", () => {
    expect(homeOf("api/README.md", homes)).toEqual({ home: "api", inHome: "README.md" });
    expect(homeOf("api/docs/plan.md", homes)).toEqual({ home: "api/docs", inHome: "plan.md" });
    expect(homeOf("api/src/deep/x.md", homes)).toEqual({ home: "api", inHome: "src/deep/x.md" });
    expect(homeOf("team/svc/a/b.md", homes)).toEqual({ home: "team/svc", inHome: "a/b.md" });
  });

  it("is the opened folder when no home is above it, and never matches on a name's prefix", () => {
    expect(homeOf("notes/idea.md", homes)).toEqual({ home: "", inHome: "notes/idea.md" });
    expect(homeOf("plan.md", homes)).toEqual({ home: "", inHome: "plan.md" });
    expect(homeOf("api2/x.md", homes)).toEqual({ home: "api2", inHome: "x.md" });
    expect(homeOf("apix/x.md", homes)).toEqual({ home: "", inHome: "apix/x.md" });
    expect(homeOf("team/other.md", homes)).toEqual({ home: "", inHome: "team/other.md" });
  });

  it("round-trips: a path in a home reads back as the opened folder's path", () => {
    for (const rel of ["api/docs/plan.md", "notes/idea.md", "team/svc/a/b.md", "x.md"]) {
      const { home, inHome } = homeOf(rel, homes);
      expect(fromHome(home, inHome)).toBe(rel);
    }
  });
});
