import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  ANUR_DIR,
  CommittedLine,
  DECISIONS_DIR,
  type CommittedEntry,
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

/** The GitHub login behind `gh`, asked once per run; null without gh or a sign-in. */
function ghLogin(): Promise<string | null> {
  let p = logins.get("gh");
  if (!p) {
    p = run("gh", ["api", "user", "--jq", ".login"], { timeout: 5000 }).then(
      (r) => r.stdout.trim() || null,
      () => null,
    );
    logins.set("gh", p);
  }
  return p;
}

/** Whose file in this place: the GitHub login when known, else a hash of the git email. */
export async function personIn(dir: string): Promise<string | null> {
  const email = await git(dir, "config", "user.email");
  let login = email ? loginFromEmail(email) : null;
  if (!login && /github\.com/.test((await git(dir, "remote", "get-url", "origin")) ?? ""))
    login = await ghLogin();
  return personKey({ login, email: email || null }, (t) =>
    createHash("sha256").update(t).digest("hex"),
  );
}

export class CommittedDecisions {
  constructor(
    private readonly folder: string,
    private readonly device: string,
    private readonly personOf: (dir: string) => Promise<string | null> = personIn,
  ) {}

  private async place(rel: string) {
    const home = await decisionsHome(this.folder, rel);
    const person = await this.personOf(home);
    if (!person) return null;
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
  }

  /**
   * A decision or finding was kept: add it to this person's file, scoped to
   * its section as "section:<doc>#<A › B>", the doc's path from where the
   * file lives, so it reads the same in the repo as in the folder.
   */
  async keep(rel: string, section: string, ref: string, entry: KeptEntry): Promise<void> {
    const at = await this.place(rel);
    if (!at) return;
    const doc = path.relative(at.home, path.join(this.folder, rel)).split(path.sep).join("/");
    const scope = `section:${doc}#${section}`;
    await this.openDecisions(at.home);
    // Kept again after an Undo: one line, not two.
    if ((await this.current(at.home)).some((e) => e.ref === ref)) return;
    await this.append(at.file, { ...entry, scope, ref });
  }

  /**
   * Taken back: a line not yet committed comes out of the file; one already
   * committed gets a "dropped" line, so history keeps both.
   */
  async drop(rel: string, ref: string): Promise<void> {
    const at = await this.place(rel);
    if (!at) return;
    for (const e of (await this.current(at.home)).filter((x) => x.ref === ref)) {
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
        await this.append(at.file, { kind: "dropped", target: e.id });
      }
    }
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
    return found.flat();
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
