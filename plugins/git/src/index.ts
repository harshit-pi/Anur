/**
 * The Git plugin (standard, by Anur): puts a folder on GitHub and keeps it in
 * sync, so a teammate who opens the same repo sees the same docs, threads and
 * decisions. It works through the person's own `git` and GitHub CLI (`gh`),
 * never a token of its own. Like Obsidian's Git plugin, a sync pulls, saves
 * what changed as one commit and pushes; a clash leaves Git's conflict
 * markers, which Anur's page already shows with Keep yours or theirs.
 */
import type {
  OpenFrom,
  OpenFromItem,
  PluginContext,
  PluginInstance,
} from "../../../packages/core/src/index.ts";

import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) =>
  `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The commit message from its template. */
export function message(template: string, name: string, now = new Date()): string {
  const text = template.replaceAll("{{date}}", stamp(now)).replaceAll("{{name}}", name).trim();
  return text || `Anur: ${stamp(now)}`;
}

/** A repo name GitHub accepts, from a folder's name. */
export function repoName(folder: string): string {
  const base = folder.split("/").filter(Boolean).pop() ?? "anur-folder";
  return (
    base
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "anur-folder"
  );
}

const ago = (since: number) => {
  const m = Math.round((Date.now() - since) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${String(m)}m ago` : `${String(Math.round(m / 60))}h ago`;
};

/** Whether a folder holds a repo inside it (not its own), a few levels down. */
export async function holdsRepos(folder: string, depth = 4): Promise<boolean> {
  const walk = async (dir: string, left: number): Promise<boolean> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === "node_modules" || e.name === ".anur") continue;
      if (e.name === ".git") {
        if (dir !== folder) return true;
        continue;
      }
      if (e.name.startsWith(".") || left <= 0) continue;
      if (await walk(path.join(dir, e.name), left - 1)) return true;
    }
    return false;
  };
  return walk(folder, depth);
}

/** A remote's page on GitHub, from its URL. */
export function webOf(remote: string): string | null {
  const m = /github\.com[:/](.+?)(\.git)?$/.exec(remote.trim());
  return m ? `https://github.com/${m[1] ?? ""}` : null;
}

type Phase =
  | { kind: "local" }
  | { kind: "holds" }
  | { kind: "inside"; top: string }
  | { kind: "icloud" }
  | { kind: "syncing" }
  | { kind: "synced" }
  | { kind: "conflicts"; files: string[] }
  | { kind: "failed"; why: string };

export function activate(ctx: PluginContext): PluginInstance {
  const git = (...args: string[]) => ctx.run("git", args, { cwd: ctx.folder });
  // Commits carry the person's name even where git has none set.
  const who = () => {
    const id = ["-c", `user.name=${ctx.person.name}`];
    if (ctx.person.handle)
      id.push("-c", `user.email=${ctx.person.handle}@users.noreply.github.com`);
    return id;
  };
  let syncing = false;
  let lastSync: number | null = null;
  let stopTimer: (() => void) | null = null;
  let phase: Phase = { kind: "local" };
  let origin: string | null = null;
  /** The space can't be a repo of its own: it holds repos, or sits inside one. */
  const stuck = (): boolean => ["holds", "inside"].includes(phase.kind);

  /** The repo this space is part of, when that's a repo around it rather than its own. */
  const outerRepo = async (): Promise<string | null> => {
    const top = await git("rev-parse", "--show-toplevel");
    if (top.code !== 0) return null;
    const [a, b] = await Promise.all([
      realpath(top.stdout.trim()).catch(() => top.stdout.trim()),
      realpath(ctx.folder).catch(() => ctx.folder),
    ]);
    return a === b ? null : a;
  };
  const isRepo = async () =>
    (await git("rev-parse", "--is-inside-work-tree")).code === 0 && !(await outerRepo());
  const remote = async () => {
    const r = await git("remote", "get-url", "origin");
    origin = r.code === 0 ? r.stdout.trim() : null;
    return origin;
  };
  const blockedByICloud = () => ctx.inICloud && !ctx.setting<boolean>("icloudOk");
  const conflicted = async () =>
    (await git("diff", "--name-only", "--diff-filter=U")).stdout.split("\n").filter(Boolean);
  /** Of git's unmerged files, those whose text still has conflict markers: the rest were resolved on the page. */
  const unresolved = async () => {
    const files = await conflicted();
    if (!files.length) return [];
    const r = await git("grep", "-l", "-e", "^<<<<<<< ", "--", ...files);
    return r.stdout.split("\n").filter(Boolean);
  };
  const waiting = async () =>
    (await git("status", "--porcelain")).stdout.split("\n").filter(Boolean).length;

  /** The status bar's item and the panel a click opens. */
  async function report(next?: Phase) {
    if (next) phase = next;
    const lines: { label: string; value: string; href?: string }[] = [];
    const web = origin ? webOf(origin) : null;
    lines.push(
      origin
        ? {
            label: "Repo",
            value: web?.replace("https://github.com/", "") ?? origin,
            ...(web ? { href: web } : {}),
          }
        : { label: "Repo", value: "Only on this Mac" },
    );
    if (lastSync !== null) lines.push({ label: "Last synced", value: ago(lastSync) });
    const changes = phase.kind === "syncing" ? 0 : await waiting();
    if (changes)
      lines.push({
        label: "Waiting",
        value: `${String(changes)} change${changes === 1 ? "" : "s"}`,
      });
    const minutes = Number(ctx.setting<string>("syncMinutes"));
    lines.push({
      label: "Syncs",
      value: minutes > 0 ? `every ${String(minutes)} min` : "when you choose",
    });
    if (phase.kind === "conflicts")
      lines.push({ label: "To resolve", value: phase.files.join(", ") });
    if (phase.kind === "failed") lines.push({ label: "Last try", value: phase.why });
    if (phase.kind === "holds" || phase.kind === "inside") {
      ctx.status({
        text: phase.kind === "holds" ? "Holds repos" : "In another repo",
        tone: "warn",
        lines: [
          phase.kind === "holds"
            ? {
                label: "Why",
                value: "This space holds repos, so Git won't make it one: each repo syncs itself.",
              }
            : {
                label: "Why",
                value: `This space is inside the repo at ${phase.top}. Open that folder as the space to sync it.`,
              },
        ],
        actions: [],
      });
      return;
    }
    const text =
      phase.kind === "icloud"
        ? "Paused in iCloud"
        : phase.kind === "syncing"
          ? "Syncing…"
          : phase.kind === "conflicts"
            ? `${String(phase.files.length)} to resolve`
            : phase.kind === "failed"
              ? "Sync failed"
              : !origin
                ? "Not on GitHub"
                : lastSync !== null
                  ? `Synced ${ago(lastSync)}`
                  : "Ready to sync";
    ctx.status({
      text,
      tone:
        phase.kind === "syncing"
          ? "busy"
          : ["icloud", "conflicts", "failed"].includes(phase.kind)
            ? "warn"
            : "ok",
      lines,
      actions:
        phase.kind === "icloud"
          ? [{ id: "continueInICloud", label: "Continue anyway" }]
          : origin
            ? [{ id: "syncNow", label: "Sync now" }]
            : [{ id: "createRepo", label: "Create private repo on GitHub" }],
    });
  }

  /** Makes the folder a repo, on this Mac only, once it may. */
  async function ensureRepo(): Promise<boolean> {
    if (await isRepo()) return true;
    if (blockedByICloud()) return false;
    // Never a repo inside a repo, nor over repos (spaces): Git syncs exactly the space.
    const top = await outerRepo();
    if (top) {
      await report({ kind: "inside", top });
      return false;
    }
    if (await holdsRepos(ctx.folder)) {
      await report({ kind: "holds" });
      return false;
    }
    const init = await git("init", "-q", "-b", "main");
    if (init.code !== 0) return false;
    await git("add", "-A");
    await git(...who(), "commit", "-q", "--allow-empty", "-m", "Anur: first version");
    return true;
  }

  async function sync(): Promise<string> {
    if (syncing) return "A sync is already running.";
    if (blockedByICloud()) {
      await report({ kind: "icloud" });
      return "This folder is in iCloud Drive, which can damage a git repo. Move it out, or choose Continue anyway.";
    }
    if (!(await ensureRepo())) {
      if (phase.kind === "holds") return "This space holds repos, so Git won't make it one.";
      if (phase.kind === "inside") return `This space is inside the repo at ${phase.top}.`;
      return "git couldn't start a repo here.";
    }
    if (!(await remote())) {
      await report({ kind: "local" });
      return "This folder isn't on GitHub yet: Create private repo first.";
    }
    syncing = true;
    await report({ kind: "syncing" });
    try {
      const before = (await git("rev-parse", "HEAD")).stdout.trim();
      // A merge left half-done: finish it once no markers are left.
      const merging = (await git("rev-parse", "-q", "--verify", "MERGE_HEAD")).code === 0;
      if (merging) {
        const open = await unresolved();
        if (open.length) {
          await report({ kind: "conflicts", files: open });
          return `Still to resolve: ${open.join(", ")}. Keep a side in each, then sync again.`;
        }
        await git("add", "-A");
        await git(...who(), "commit", "--no-edit", "-q");
      }
      await git("add", "-A");
      if ((await git("status", "--porcelain")).stdout.trim())
        await git(
          ...who(),
          "commit",
          "-q",
          "-m",
          message(ctx.setting<string>("commitMessage"), ctx.person.name),
        );
      const branch = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim() || "main";
      const fetched = await git("fetch", "-q", "origin");
      if (fetched.code !== 0) {
        await report({
          kind: "failed",
          why: fetched.stderr.trim().split("\n")[0] ?? "couldn't reach GitHub",
        });
        return fetched.stderr.trim() || "Couldn't reach GitHub.";
      }
      const theirs = (await git("rev-parse", "-q", "--verify", `origin/${branch}`)).code === 0;
      if (theirs) {
        const merged = await git(...who(), "merge", "--no-edit", "-q", `origin/${branch}`);
        if (merged.code !== 0) {
          const open = await conflicted();
          ctx.filesChanged();
          if (open.length) {
            await report({ kind: "conflicts", files: open });
            return `A teammate changed the same lines in ${open.join(", ")}. Keep a side in each, then sync again.`;
          }
          await report({
            kind: "failed",
            why: merged.stderr.trim().split("\n")[0] ?? "the pull failed",
          });
          return merged.stderr.trim() || "The pull didn't go through.";
        }
      }
      if ((await git("rev-parse", "HEAD")).stdout.trim() !== before) ctx.filesChanged();
      const pushed = await git("push", "-q", "-u", "origin", "HEAD");
      if (pushed.code !== 0) {
        await report({
          kind: "failed",
          why: pushed.stderr.trim().split("\n")[0] ?? "the push failed",
        });
        return pushed.stderr.trim() || "The push didn't go through.";
      }
      lastSync = Date.now();
      return "Synced with GitHub.";
    } finally {
      syncing = false;
      if (phase.kind === "syncing") await report({ kind: "synced" });
    }
  }

  async function createRepo(): Promise<string> {
    if (blockedByICloud())
      return "This folder is in iCloud Drive, which can damage a git repo. Move it out, or choose Continue anyway first.";
    if (!(await ensureRepo()))
      return phase.kind === "holds"
        ? "This space holds repos, so Git won't make it one: each repo syncs itself."
        : phase.kind === "inside"
          ? `This space is inside the repo at ${phase.top}. Open that folder as the space to sync it.`
          : "git couldn't start a repo here.";
    const already = await remote();
    if (already) return `This folder is already on GitHub: ${webOf(already) ?? already}`;
    // Only now GitHub: a space that can't be a repo never sends anyone to sign in.
    const signedIn = await ctx.run("gh", ["auth", "status"]);
    if (signedIn.code !== 0)
      return "Sign in to GitHub first: in Terminal, run `gh auth login`, then try again.";
    await git("add", "-A");
    await git(...who(), "commit", "-q", "--allow-empty", "-m", "Anur: first version");
    const name = repoName(ctx.folder);
    const made = await ctx.run(
      "gh",
      ["repo", "create", name, "--private", "--source", ".", "--remote", "origin", "--push"],
      { cwd: ctx.folder },
    );
    if (made.code !== 0) return made.stderr.trim() || "GitHub didn't create the repo.";
    await remote();
    lastSync = Date.now();
    await report({ kind: "synced" });
    return `Created the private repo ${name} on GitHub and pushed this folder.`;
  }

  const schedule = () => {
    stopTimer?.();
    stopTimer = null;
    const minutes = Number(ctx.setting<string>("syncMinutes"));
    if (minutes > 0) stopTimer = ctx.every(minutes * 60_000, () => sync().then(() => undefined));
  };
  schedule();
  // The item's "2m ago" stays fresh.
  ctx.every(60_000, () => report());
  ctx.onQuit(async () => {
    if (ctx.setting<boolean>("pushOnQuit") && origin) await sync();
  });
  void (async () => {
    if (blockedByICloud()) return report({ kind: "icloud" });
    // On for a folder that isn't a repo: it becomes one, on this Mac only.
    if (!(await ensureRepo()) && stuck()) return;
    const url = await remote();
    if (url && ctx.setting<boolean>("pullOnOpen")) await sync();
    else await report({ kind: url ? "synced" : "local" });
  })();

  return {
    actions: {
      createRepo,
      syncNow: sync,
      continueInICloud: async () => {
        await ctx.setSetting("icloudOk", true);
        await ensureRepo();
        await remote();
        await report({ kind: origin ? "synced" : "local" });
        return "Git will work in this folder in iCloud Drive.";
      },
    },
    settingsChanged: () => {
      schedule();
      void report();
    },
    stop: () => {
      stopTimer?.();
      ctx.status(null);
    },
  };
}

/** Open from GitHub: your repos and ones shared with you, cloned into a new folder. */
export const openFrom: OpenFrom = {
  async list(run) {
    const out = new Map<string, OpenFromItem & { at: string }>();
    const add = (name: string, priv: boolean, at: string, why: string) => {
      if (!out.has(name))
        out.set(name, {
          id: name,
          label: name,
          detail: `${priv ? "private" : "public"} · ${why}`,
          at,
        });
    };
    const mine = await run("gh", [
      "repo",
      "list",
      "--limit",
      "100",
      "--json",
      "nameWithOwner,isPrivate,updatedAt",
    ]);
    if (mine.code !== 0)
      throw new Error("Sign in to GitHub first: in Terminal, run `gh auth login`, then try again.");
    for (const r of JSON.parse(mine.stdout || "[]") as {
      nameWithOwner: string;
      isPrivate: boolean;
      updatedAt: string;
    }[])
      add(r.nameWithOwner, r.isPrivate, r.updatedAt, "yours");
    const shared = await run("gh", [
      "api",
      "user/repos?affiliation=collaborator,organization_member&per_page=100&sort=updated",
    ]);
    if (shared.code === 0)
      for (const r of JSON.parse(shared.stdout || "[]") as {
        full_name: string;
        private: boolean;
        updated_at: string;
      }[])
        add(r.full_name, r.private, r.updated_at, "shared with you");
    return [...out.values()]
      .sort((a, b) => b.at.localeCompare(a.at))
      .map(({ id, label, detail }) => ({ id, label, detail }));
  },
  async open(run, id, dest) {
    const r = await run("gh", ["repo", "clone", id, dest], { timeoutMs: 600_000 });
    return r.code === 0 ? null : r.stderr.trim() || "GitHub didn't clone it.";
  },
};
