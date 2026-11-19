import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { installPreCommit, writeLocalMd, writeUserClaudeMd, type About } from "@anur/system";
import os from "node:os";
import { loginPath } from "../agent/find-claude.ts";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  ANUR_DIR,
  CommittedLine,
  DECISIONS_DIR,
  type CommittedEntry,
  type DecisionScope,
  anurPaths,
  currentEntries,
  gitignoreKeepingDecisions,
  loginFromEmail,
  nextStamp,
  parseJsonl,
  personKey,
} from "@anur/core";

const run = promisify(execFile);

/**
 * Decisions and kept findings, committed with the folder (18.9) or the repo
 * they're about (23.2): `.anur/decisions/<person>.jsonl`. Each person writes
 * only their own file; a drop is a line there, never an edit to another's.
 * An Undo before the line is committed takes it out instead, so a commit
 * never carries a decision and its own Undo.
 */

export type KeptEntry =
  | {
      kind: "decision";
      decision: string;
      quote: string | null;
      instead: string | null;
      until: string | null;
      who: string | null;
      concerns?: "work" | "subject";
      /** The decision it goes against (18.4), by ID. */
      against?: string | null;
    }
  | { kind: "finding"; claim: string; source: string | null };

async function git(dir: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["-C", dir, ...args], { timeout: 5000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/** Where a doc's decisions go: the repo holding it inside the folder, else the folder. */
export async function decisionsHome(folder: string, rel: string): Promise<string> {
  let dir = path.dirname(path.join(folder, rel));
  const root = path.resolve(folder);
  while (dir.startsWith(root) && dir !== root) {
    if (await exists(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return root;
}

const logins = new Map<string, Promise<string | null>>();

/**
 * The GitHub login behind `gh`, asked once per PATH; null without gh or a
 * sign-in. Looked up on the login shell's PATH: an app opened from Finder
 * runs with a bare one, without Homebrew's `gh`, and would file the same
 * person's decisions under an email hash instead.
 */
function ghLogin(pathNow: string): Promise<string | null> {
  let p = logins.get(pathNow);
  if (!p) {
    p = run("gh", ["api", "user", "--jq", ".login"], {
      timeout: 5000,
      env: { ...process.env, PATH: pathNow },
    }).then(
      (r) => r.stdout.trim() || null,
      () => null,
    );
    logins.set(pathNow, p);
  }
  return p;
}

/** Whose file in this place: the GitHub login when known, else a hash of the git email. */
export async function personIn(
  dir: string,
  pathOf: () => Promise<string> = loginPath,
): Promise<string | null> {
  const email = await git(dir, "config", "user.email");
  // The GitHub login wherever there is one, not only in a GitHub repo, so a
  // person is one name in every folder (2026-11-19 review).
  const login = (email ? loginFromEmail(email) : null) ?? (await ghLogin(await pathOf()));
  return personKey({ login, email: email || null }, sha256);
}

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** The name a person's file had before their login was known: their email's hash. */
export async function emailKeyIn(dir: string): Promise<string | null> {
  const email = await git(dir, "config", "user.email");
  return email ? personKey({ login: null, email }, sha256) : null;
}

export class CommittedDecisions {
  constructor(
    private readonly folder: string,
    private readonly device: string,
    private readonly personOf: (dir: string) => Promise<string | null> = personIn,
    /** A repo's pre-commit hook gets Anur's lines when a decision first lands there (23.6). */
    private readonly hookFor: (home: string) => void = (home) => {
      if (existsSync(path.join(home, ".git"))) installPreCommit(home);
    },
    /** The person's not-yet-merged decisions, in their own `CLAUDE.local.md` (23.9). */
    private readonly localFor: (home: string) => void = (home) => {
      if (existsSync(path.join(home, ".git"))) writeLocalMd(home);
    },
    /**
     * Where decisions kept for everywhere live (18.3): the person's own, in
     * their home folder, never committed with any repo.
     */
    private readonly personalHome: string = os.homedir(),
    /** Decisions kept for everywhere, in Claude Code's own user `CLAUDE.md` (18.3). */
    private readonly everywhereFor: (entries: CommittedEntry[]) => void = writeUserClaudeMd,
    /**
     * A decision on a call changed: the repo at the other end lists it in its
     * own `CLAUDE.local.md` (23.10). Only a system folder knows both ends.
     */
    private readonly sidesFor: () => void = () => undefined,
    /** The person's older name here, their email's hash, whose file joins their login's. */
    private readonly emailKeyOf: (dir: string) => Promise<string | null> = emailKeyIn,
  ) {}

  /**
   * A file kept under the person's email hash, from before their login was
   * known, joins their login's file: one person, one name (2026-11-19).
   */
  private async adoptEmailFile(home: string, person: string) {
    const old = await this.emailKeyOf(home);
    if (!old || old === person) return;
    const from = path.join(home, ANUR_DIR, anurPaths.decisions(old));
    const text = await readFile(from, "utf8").catch(() => null);
    if (text === null) return;
    const to = path.join(home, ANUR_DIR, anurPaths.decisions(person));
    const mine = await readFile(to, "utf8").catch(() => "");
    const have = new Set(mine.split("\n").filter(Boolean));
    const add = text.split("\n").filter((row) => row.trim() && !have.has(row));
    const sep = mine === "" || mine.endsWith("\n") ? "" : "\n";
    await writeFile(to, `${mine}${sep}${add.map((r) => `${r}\n`).join("")}`);
    await unlink(from);
  }

  private async place(rel: string) {
    const home = await decisionsHome(this.folder, rel);
    const person = await this.personOf(home);
    if (!person) return null;
    await this.adoptEmailFile(home, person).catch(() => undefined);
    const file = path.join(home, ANUR_DIR, anurPaths.decisions(person));
    return { home, person, file };
  }

  /** A folder that keeps `.anur/` out of git still commits its decisions. */
  private async openDecisions(home: string) {
    await mkdir(path.join(home, ANUR_DIR, DECISIONS_DIR), { recursive: true });
    const ignore = path.join(home, ANUR_DIR, anurPaths.gitignore());
    const now = await readFile(ignore, "utf8").catch(() => null);
    const next = gitignoreKeepingDecisions(now);
    if (next !== null) await writeFile(ignore, next);
  }

  private async lines(file: string) {
    const text = await readFile(file, "utf8").catch(() => "");
    return parseJsonl(text, CommittedLine).lines;
  }

  private async append(file: string, body: Record<string, unknown>) {
    const mine = (await this.lines(file)).filter((l) => l.dev === this.device);
    const stamp = nextStamp(mine.at(-1) ?? null, Date.now());
    const line = { id: randomUUID(), ...stamp, dev: this.device, ...body };
    CommittedLine.parse(line);
    const text = await readFile(file, "utf8").catch(() => "");
    const sep = text === "" || text.endsWith("\n") ? "" : "\n";
    await writeFile(file, `${text}${sep}${JSON.stringify(line)}\n`);
    return line.id;
  }

  /**
   * A decision or finding was kept: add it to this person's file at its
   * scope (18.3). A section's is "section:<doc>#<A › B>" and a doc's
   * "section:<doc>#", the doc's path from where the file lives, so it reads
   * the same in the repo as in the folder; a folder's or repo's is "repo" in
   * the doc's home; everywhere's is kept in the person's own file, outside
   * any repo. Kept again at another scope, it moves.
   */
  async keep(
    rel: string,
    section: string,
    ref: string,
    entry: KeptEntry,
    scope: DecisionScope = "section",
  ): Promise<string | null> {
    const at = await this.place(rel);
    if (!at) return null;
    const doc = path.relative(at.home, path.join(this.folder, rel)).split(path.sep).join("/");
    const target =
      scope === "everywhere"
        ? {
            home: this.personalHome,
            person: at.person,
            file: path.join(this.personalHome, ANUR_DIR, anurPaths.decisions(at.person)),
          }
        : at;
    const as =
      scope === "everywhere"
        ? "everywhere"
        : scope === "folder"
          ? "repo"
          : scope === "doc"
            ? `section:${doc}#`
            : `section:${doc}#${section}`;
    // Already kept: as it is, or at another scope or with another "until"
    // (kept again after it passed, 18.2), which replaces it.
    const here = (await this.current(target.home)).find((e) => e.ref === ref);
    const sameUntil =
      here?.kind !== "decision" || entry.kind !== "decision" || here.until === entry.until;
    if (here?.scope === as && sameUntil) return here.id;
    if (
      (await this.current(at.home)).some((e) => e.ref === ref) ||
      (await this.personal()).some((e) => e.ref === ref)
    )
      await this.drop(rel, ref);
    if (scope === "everywhere") {
      await mkdir(path.dirname(target.file), { recursive: true });
      const id = await this.append(target.file, { ...entry, scope: as, ref });
      this.refreshEverywhere();
      return id;
    }
    return this.keepIn(at, as, ref, entry);
  }

  /** The person's decisions kept for everywhere. */
  private personal() {
    return this.current(this.personalHome);
  }

  private refreshEverywhere() {
    void this.personal()
      .then((all) => {
        this.everywhereFor(all);
      })
      .catch(() => undefined);
  }

  /**
   * Kept for a whole place, not a doc's section, as from a terminal session
   * working in a repo (23.4): scoped "repo" at the repo's root, else
   * "folder:<dir>" from where the file lives.
   */
  async keepFor(
    dir: string,
    ref: string,
    entry: KeptEntry,
    about: About | null = null,
  ): Promise<string | null> {
    // A file name inside the dir, so the home is found from the dir itself.
    const at = await this.place(path.join(dir, ".anur-here"));
    if (!at) return null;
    if (about) {
      // On a part or a line (23.1), kept where the session works.
      const within =
        about.kind === "part"
          ? path.relative(at.home, path.join(this.folder, about.dir)).split(path.sep).join("/")
          : null;
      return this.keepIn(at, about.scope, ref, entry, {
        on: about.on,
        within: within === null || within.startsWith("..") ? null : within,
      });
    }
    const rel = path.relative(at.home, path.join(this.folder, dir)).split(path.sep).join("/");
    return this.keepIn(at, rel ? `folder:${rel}` : "repo", ref, entry);
  }

  private async keepIn(
    at: { home: string; file: string },
    scope: string,
    ref: string,
    entry: KeptEntry,
    extra: { on: string; within: string | null } | null = null,
  ): Promise<string | null> {
    await this.openDecisions(at.home);
    // Kept again after an Undo: one line, not two.
    const already = (await this.current(at.home)).find((e) => e.ref === ref);
    if (already) return already.id;
    const id = await this.append(at.file, { ...entry, scope, ref, ...extra });
    try {
      this.hookFor(at.home);
    } catch {
      // A hook that can't be written leaves the decision kept; 23.8 shows it isn't active.
    }
    this.refreshLocal(at.home);
    if (scope.startsWith("edge:")) this.sidesFor();
    return id;
  }

  /** The next session sees what changed at once, through `CLAUDE.local.md` (23.9). */
  private refreshLocal(home: string) {
    try {
      this.localFor(home);
    } catch {
      // The decision stands; the local file catches up on the next change.
    }
  }

  /**
   * A task's change found to go against a decision (24.1), in the author's
   * file in the repo the change is in, so the PR check shows it without a
   * model; a later one for the same task and decision says what the person
   * made of it.
   */
  async noteAgainst(
    dir: string,
    body: {
      target: string;
      task: string;
      file: string | null;
      line: number | null;
      why: string;
      confidence: number;
      status: "asserted" | "asked" | "confirmed" | "dismissed";
    },
  ): Promise<void> {
    const at = await this.place(path.join(dir, ".anur-here"));
    if (!at) return;
    await this.openDecisions(at.home);
    await this.append(at.file, { kind: "against", ...body });
  }

  /**
   * Taken back: a line not yet committed comes out of the file; one already
   * committed gets a "dropped" line, so history keeps both.
   */
  async drop(rel: string, ref: string): Promise<void> {
    const at = await this.place(rel);
    if (!at) return;
    for (const e of (await this.current(at.home)).filter((x) => x.ref === ref))
      await this.dropEntry(at, e);
    // Kept for everywhere: never committed, so it simply comes out.
    for (const e of (await this.personal()).filter((x) => x.ref === ref)) {
      const own = path.join(this.personalHome, ANUR_DIR, anurPaths.decisions(e.person));
      const text = await readFile(own, "utf8").catch(() => "");
      await writeFile(
        own,
        text
          .split("\n")
          .filter((row) => !row.includes(`"id":"${e.id}"`))
          .join("\n"),
      );
      this.refreshEverywhere();
    }
    this.refreshLocal(at.home);
  }

  /**
   * Taken back: a line of one's own not yet committed comes out of the
   * file; anything else gets a "dropped" line in one's own file.
   */
  private async dropEntry(
    at: { home: string; person: string; file: string },
    e: CommittedEntry,
  ): Promise<void> {
    if (e.scope.startsWith("edge:")) this.sidesFor();
    const ownFile = path.join(at.home, ANUR_DIR, anurPaths.decisions(e.person));
    const committed = await git(
      at.home,
      "show",
      `HEAD:${path.relative(at.home, ownFile).split(path.sep).join("/")}`,
    );
    if (e.person === at.person && !committed?.includes(e.id)) {
      const text = await readFile(ownFile, "utf8");
      await writeFile(
        ownFile,
        text
          .split("\n")
          .filter((row) => !row.includes(`"id":"${e.id}"`))
          .join("\n"),
      );
    } else {
      await mkdir(path.dirname(at.file), { recursive: true });
      await this.append(at.file, { kind: "dropped", target: e.id });
    }
  }

  /**
   * One that needs a look (18.2), anyone's, by its home ("" the folder, "~"
   * one's own everywhere) and ID: dropped, or kept again in one's own file,
   * with no "until" or for the whole doc its section was in. The old line is
   * taken back as a drop is, so history keeps both.
   */
  async revise(
    home: string,
    id: string,
    change: { until?: null; scope?: string } | "drop",
  ): Promise<void> {
    const dir = home === "~" ? this.personalHome : path.join(this.folder, home);
    const e = (await this.current(dir)).find((x) => x.id === id);
    if (!e) return;
    const person = await this.personOf(dir);
    if (!person) return;
    const at = { home: dir, person, file: path.join(dir, ANUR_DIR, anurPaths.decisions(person)) };
    await this.dropEntry(at, e);
    if (change !== "drop") {
      const { id: _id, at: _at, seq: _seq, dev: _dev, person: _p, ...body } = e;
      await this.openDecisions(dir);
      await this.append(at.file, {
        ...body,
        ...(change.scope ? { scope: change.scope, within: null } : {}),
        ...(change.until === null && body.kind === "decision" ? { until: null } : {}),
      });
    }
    if (home === "~") this.refreshEverywhere();
    else this.refreshLocal(dir);
  }

  /**
   * The opened folder's one reader (18.14): its own decisions and every
   * home a plugin names, such as each repo in a system. Each entry says
   * which home it came from, folder-relative ("" for the folder's own).
   */
  async all(homes: readonly string[]): Promise<(CommittedEntry & { home: string })[]> {
    const places = ["", ...new Set(homes.filter((h) => h && h !== "."))];
    const found = await Promise.all(
      places.map(async (home) =>
        (await this.current(path.join(this.folder, home))).map((e) => ({ ...e, home })),
      ),
    );
    // And the person's own, kept for everywhere (18.3), unless that's this folder.
    const personal =
      path.resolve(this.personalHome) === path.resolve(this.folder)
        ? []
        : (await this.personal()).map((e) => ({ ...e, home: "~" }));
    return [...found.flat(), ...personal];
  }

  /** Every person's decisions and findings here, less what anyone dropped. */
  async current(home: string) {
    const dir = path.join(home, ANUR_DIR, DECISIONS_DIR);
    const names = await readdir(dir).catch(() => [] as string[]);
    const files = await Promise.all(
      names
        .filter((n) => n.endsWith(".jsonl"))
        .map(async (n) => ({
          person: n.slice(0, -".jsonl".length),
          text: await readFile(path.join(dir, n), "utf8").catch(() => ""),
        })),
    );
    return currentEntries(files);
  }
}
