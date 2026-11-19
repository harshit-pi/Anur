import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installPreCommit } from "@anur/system";
import { shimPath, shimText, writeShim } from "./pre-commit-shim.ts";

const CLI = path.resolve(import.meta.dirname, "../../../system/src/cli.ts");
const tmp = (p: string) => mkdtempSync(path.join(tmpdir(), p));

describe("the pre-commit script repos' hooks call (23.6)", () => {
  it("is written executable, and the released app always points it at itself", async () => {
    const home = tmp("anur-shim-");
    expect(await writeShim({ app: "/A/Anur", cli: "/A/cli.js", release: true, home })).toBe(true);
    expect(statSync(shimPath(home)).mode & 0o111).not.toBe(0);
    expect(await writeShim({ app: "/A/Anur", cli: "/A/cli.js", release: true, home })).toBe(false);
    expect(await writeShim({ app: "/B/Anur", cli: "/B/cli.js", release: true, home })).toBe(true);
    expect(readFileSync(shimPath(home), "utf8")).toBe(shimText("/B/Anur", "/B/cli.js"));
  });

  it("is left to a live app by a dev build, and taken over by one when the app it names is gone", async () => {
    const home = tmp("anur-shim-");
    const live = path.join(home, "Anur");
    writeFileSync(live, "");
    await writeShim({ app: live, cli: "/A/cli.js", release: true, home });
    expect(
      await writeShim({ app: "/Dev/Anur Dev", cli: "/Dev/cli.js", release: false, home }),
    ).toBe(false);
    await writeShim({ app: "/gone/Anur", cli: "/A/cli.js", release: true, home });
    expect(
      await writeShim({ app: "/Dev/Anur Dev", cli: "/Dev/cli.js", release: false, home }),
    ).toBe(true);
  });

  it("runs the CLI from a real commit, with a path holding spaces and a quote", () => {
    const home = tmp("anur-shim-");
    const odd = path.join(tmp("anur shim's-"), "cli dir");
    mkdirSync(odd, { recursive: true });
    const cli = path.join(odd, "cli.ts");
    writeFileSync(cli, `await import(${JSON.stringify(CLI)});\n`);
    mkdirSync(path.dirname(shimPath(home)), { recursive: true });
    // Node stands in for the app's Electron, which runs the CLI as Node.
    writeFileSync(shimPath(home), shimText(process.execPath, cli), { mode: 0o755 });
    const repo = tmp("anur-shim-repo-");
    const env = {
      ...process.env,
      HOME: home,
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@e.com",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@e.com",
    };
    const git = (...a: string[]) =>
      execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env });
    git("init", "-q", "-b", "main");
    installPreCommit(repo);
    mkdirSync(path.join(repo, ".anur", "decisions"), { recursive: true });
    writeFileSync(
      path.join(repo, ".anur", "decisions", "sam.jsonl"),
      `${JSON.stringify({ id: "d-0000001", at: "2026-11-18T10:00:00.000Z", dev: "m", seq: 0, kind: "decision", scope: "repo", ref: null, decision: "Three retries.", quote: "three retries", instead: null, until: null, who: "Sam" })}\n`,
    );
    git("add", "-A");
    git("commit", "-q", "-m", "A decision");
    expect(git("show", "HEAD:CLAUDE.md")).toContain("- Three retries. (Sam)");
  });
});

describe("keeping the script current", () => {
  it("is always brought up to date by the app it names, a dev build too", async () => {
    const home = tmp("anur-shim-");
    const dev = path.join(home, "Anur Dev");
    writeFileSync(dev, "");
    await writeShim({ app: dev, cli: "/Dev/old-cli.js", release: false, home });
    expect(await writeShim({ app: dev, cli: "/Dev/new-cli.js", release: false, home })).toBe(true);
    expect(readFileSync(shimPath(home), "utf8")).toBe(shimText(dev, "/Dev/new-cli.js"));
  });

  it("checks only the app before running, since the CLI sits inside the app's archive", () => {
    const text = shimText("/A/Anur", "/A/app.asar/out/main/system-cli.js");
    expect(text).toContain('[ -x "$APP" ] || exit 0');
    expect(text).not.toContain('[ -f "$CLI" ]');
  });
});
