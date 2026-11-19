import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codeRepos, looksLikeCode } from "./engineering-offer.ts";

const repo = (dir: string, files: Record<string, string>) => {
  mkdirSync(path.join(dir, ".git"), { recursive: true });
  for (const [f, t] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), t);
  }
};

describe("the Engineering offer counts code repos", () => {
  it("counts repos with a build file, not a repo of notes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-offer-"));
    repo(path.join(dir, "api"), { "package.json": "{}" });
    repo(path.join(dir, "infra"), { "stacks/cdk.json": "{}" });
    repo(path.join(dir, "group", "worker"), { "go.mod": "module w" });
    repo(path.join(dir, "notes"), { "Readme.md": "# notes" });
    expect(codeRepos(dir)).toBe(3);
  });

  it("finds none in a vault that is itself a repo of notes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-offer-"));
    repo(dir, { "Ideas.md": "x", "raw/Plan.md": "y" });
    expect(codeRepos(dir)).toBe(0);
  });

  it("counts infrastructure as code, such as an Amplify or Terraform repo, and a notes vault as not", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-offer-"));
    repo(path.join(dir, "amplify"), { "amplify.yml": "version: 1", "amplify/cli.json": "{}" });
    repo(path.join(dir, "infra"), { "envs/main.tf": "" });
    repo(path.join(dir, "vault"), { "Home.md": "# Home", ".obsidian/app.json": "{}" });
    expect(looksLikeCode(path.join(dir, "amplify"))).toBe(true);
    expect(looksLikeCode(path.join(dir, "infra"))).toBe(true);
    expect(looksLikeCode(path.join(dir, "vault"))).toBe(false);
  });
});
