import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginContext, PluginInstance, PluginStatus } from "@anur/core";
import { activate, message, repoName, webOf } from "../../../../../plugins/git/src/index.ts";
import { runWith } from "./runtime.ts";

const temp = (p: string) => mkdtempSync(path.join(tmpdir(), p));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

/** A folder with the Git plugin on, as Anur gives it a context; GitHub is a bare repo on disk. */
function open(folder: string, name: string, values: Record<string, string | boolean> = {}) {
  const statuses: (PluginStatus | null)[] = [];
  const settings: Record<string, string | boolean> = {
    syncMinutes: "0",
    pullOnOpen: false,
    pushOnQuit: true,
    commitMessage: "Anur: {{date}} by {{name}}",
    ...values,
  };
  let changed = 0;
  const ctx: PluginContext = {
    folder,
    inICloud: false,
    person: { name, handle: name.toLowerCase() },
    setting: ((k: string) => settings[k]) as PluginContext["setting"],
    setSetting: (k, v) => {
      settings[k] = v;
      return Promise.resolve();
    },
    run: runWith(() => Promise.resolve(process.env.PATH ?? "")),
    status: (s) => statuses.push(s),
    notify: () => undefined,
    every: () => () => undefined,
    onQuit: () => undefined,
    filesChanged: () => {
      changed++;
    },
  };
  const plugin: PluginInstance = activate(ctx);
  const act = (a: string) => plugin.actions?.[a]?.() ?? Promise.resolve("no action");
  return { plugin, act, statuses, changed: () => changed, settings };
}
const settle = () => new Promise((r) => setTimeout(r, 1500));

describe("the Git plugin", () => {
  it("names a repo and a commit as a person reads them", () => {
    expect(repoName("/Users/sam/Anur/Launch Plans")).toBe("Launch-Plans");
    expect(message("Anur: {{date}} by {{name}}", "Sam", new Date(2026, 10, 19, 9, 5))).toBe(
      "Anur: 2026-11-19 09:05 by Sam",
    );
    expect(webOf("git@github.com:harshit-pi/plans.git")).toBe(
      "https://github.com/harshit-pi/plans",
    );
    expect(webOf("https://github.com/harshit-pi/plans.git")).toBe(
      "https://github.com/harshit-pi/plans",
    );
  });

  it("makes a folder a repo when it's switched on, on this Mac only", async () => {
    const folder = temp("anur-git-init-");
    writeFileSync(path.join(folder, "plan.md"), "# Plan\n");
    const a = open(folder, "Sam");
    await settle();
    expect(existsSync(path.join(folder, ".git"))).toBe(true);
    expect(git(folder, "log", "--format=%s")).toBe("Anur: first version");
    expect(a.statuses.at(-1)?.text).toBe("Not on GitHub");
    expect(a.statuses.at(-1)?.actions?.[0]?.id).toBe("createRepo");
  });

  it("syncs two people's folders through one remote, and shows a clash until it's resolved", async () => {
    const origin = temp("anur-git-origin-");
    git(origin, "init", "-q", "--bare", "-b", "main");
    // Sam's folder: on, given a remote, synced.
    const sam = temp("anur-git-sam-");
    writeFileSync(path.join(sam, "plan.md"), "# Plan\n\nPrice: £5.\n");
    const a = open(sam, "Sam");
    await settle();
    git(sam, "remote", "add", "origin", origin);
    expect(await a.act("syncNow")).toBe("Synced with GitHub.");
    // Priya clones it, as Open from GitHub would, and edits.
    const priya = path.join(temp("anur-git-priya-"), "plan");
    execFileSync("git", ["clone", "-q", origin, priya]);
    const b = open(priya, "Priya");
    await settle();
    writeFileSync(path.join(priya, "plan.md"), "# Plan\n\nPrice: £5.\n\n## Launch\n\nDecember.\n");
    expect(await b.act("syncNow")).toBe("Synced with GitHub.");
    expect(git(priya, "log", "-1", "--format=%an %s")).toMatch(
      /^Priya Anur: \d{4}-\d\d-\d\d \d\d:\d\d by Priya$/,
    );
    // Sam's next sync brings Priya's section, and Anur is told to read the files again.
    const before = a.changed();
    expect(await a.act("syncNow")).toBe("Synced with GitHub.");
    expect(readFileSync(path.join(sam, "plan.md"), "utf8")).toContain("## Launch");
    expect(a.changed()).toBeGreaterThan(before);
    // Both change the same line: the second to sync sees the clash.
    writeFileSync(path.join(sam, "plan.md"), "# Plan\n\nPrice: £4.\n\n## Launch\n\nDecember.\n");
    expect(await a.act("syncNow")).toBe("Synced with GitHub.");
    writeFileSync(path.join(priya, "plan.md"), "# Plan\n\nPrice: £6.\n\n## Launch\n\nDecember.\n");
    expect(await b.act("syncNow")).toMatch(/changed the same lines in plan\.md/);
    expect(readFileSync(path.join(priya, "plan.md"), "utf8")).toContain("<<<<<<<");
    expect(b.statuses.at(-1)).toMatchObject({ text: "1 to resolve", tone: "warn" });
    expect(await b.act("syncNow")).toMatch(/Still to resolve: plan\.md/);
    // Priya keeps a side, as Anur's conflict bar does; the next sync finishes the merge.
    writeFileSync(path.join(priya, "plan.md"), "# Plan\n\nPrice: £4.\n\n## Launch\n\nDecember.\n");
    expect(await b.act("syncNow")).toBe("Synced with GitHub.");
    expect(await a.act("syncNow")).toBe("Synced with GitHub.");
    expect(readFileSync(path.join(sam, "plan.md"), "utf8")).toBe(
      "# Plan\n\nPrice: £4.\n\n## Launch\n\nDecember.\n",
    );
    expect(a.statuses.at(-1)?.lines?.find((l) => l.label === "Last synced")?.value).toBe(
      "just now",
    );
  }, 60_000);

  it("waits in iCloud Drive until the person says to go ahead", async () => {
    const folder = path.join(temp("anur-git-icloud-"), "Library", "Mobile Documents", "docs");
    mkdirSync(folder, { recursive: true });
    const statuses: (PluginStatus | null)[] = [];
    let ok = false;
    const plugin = activate({
      folder,
      inICloud: true,
      person: { name: "Sam", handle: null },
      setting: ((k: string) =>
        k === "icloudOk" ? ok : k === "syncMinutes" ? "0" : false) as PluginContext["setting"],
      setSetting: (_k, v) => {
        ok = v === true;
        return Promise.resolve();
      },
      run: runWith(() => Promise.resolve(process.env.PATH ?? "")),
      status: (s) => statuses.push(s),
      notify: () => undefined,
      every: () => () => undefined,
      onQuit: () => undefined,
      filesChanged: () => undefined,
    });
    await settle();
    expect(existsSync(path.join(folder, ".git"))).toBe(false);
    expect(statuses.at(-1)).toMatchObject({ text: "Paused in iCloud", tone: "warn" });
    await plugin.actions?.continueInICloud?.();
    expect(existsSync(path.join(folder, ".git"))).toBe(true);
  });
});
