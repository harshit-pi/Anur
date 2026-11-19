import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publicRepoFor, threadsCommitted } from "./public-repo.ts";

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args]);

function folder(remote: string | null) {
  const dir = mkdtempSync(path.join(tmpdir(), "anur-public-"));
  git(dir, "init", "-q", "-b", "main");
  if (remote) git(dir, "remote", "add", "origin", remote);
  mkdirSync(path.join(dir, ".anur"));
  return dir;
}

describe("threads in a public repo (18.13)", () => {
  it("knows when git would commit the folder's threads, by every ignore rule", async () => {
    expect(await threadsCommitted(mkdtempSync(path.join(tmpdir(), "anur-public-")))).toBe(false);
    const open = folder(null);
    expect(await threadsCommitted(open)).toBe(true);
    const optedOut = folder(null);
    writeFileSync(
      path.join(optedOut, ".anur/.gitignore"),
      "*\n!.gitignore\n!decisions/\n!decisions/*.jsonl\n",
    );
    expect(await threadsCommitted(optedOut)).toBe(false);
    const rootIgnores = folder(null);
    writeFileSync(path.join(rootIgnores, ".gitignore"), ".anur/\n");
    expect(await threadsCommitted(rootIgnores)).toBe(false);
  });

  it("names a public GitHub repo only when its threads would be committed to it", async () => {
    const isPublic = () => Promise.resolve(true);
    const pub = folder("git@github.com:acme/site.git");
    expect(await publicRepoFor(pub, isPublic)).toBe("acme/site");
    expect(await publicRepoFor(pub, () => Promise.resolve(false))).toBeNull();
    // Unknown, as offline: no question rather than a wrong one.
    expect(await publicRepoFor(pub, () => Promise.resolve(null))).toBeNull();
    expect(await publicRepoFor(folder("https://gitlab.com/acme/site.git"), isPublic)).toBeNull();
    const kept = folder("https://github.com/acme/site");
    writeFileSync(path.join(kept, ".anur/.gitignore"), "*\n");
    expect(await publicRepoFor(kept, isPublic)).toBeNull();
  });
});
