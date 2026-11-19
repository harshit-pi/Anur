import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Homes (18.15.1): where Anur keeps what it knows about a doc. A home is the
 * nearest folder above the doc holding `.anur/` or `.git`, else the opened
 * folder. Each home keeps its docs by their path from it, so a doc's IDs,
 * history and threads are the same whichever level is opened: the repo on
 * its own, or the workspace holding it.
 *
 * The opened folder finds every home beneath it, skipping what git ignores
 * (build output, vendored code) and `node_modules`, and never looking inside
 * dot-folders, though a folder's own `.anur/` and `.git` mark it a home.
 */

/** Folders never walked: too big, never holding docs of their own. */
const SKIP = new Set(["node_modules"]);
/** How deep the walk goes below the opened folder. */
const MAX_DEPTH = 8;

/** The ones among `dirs` (relative to `repo`) that git ignores there. */
function ignoredIn(repo: string, dirs: readonly string[]): Promise<Set<string>> {
  if (dirs.length === 0) return Promise.resolve(new Set());
  return new Promise((resolve) => {
    // check-ignore prints each ignored path; exit 1 means none are.
    const git = spawn("git", ["-C", repo, "check-ignore", "--stdin"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    git.stdout.setEncoding("utf8");
    git.stdout.on("data", (d: string) => {
      out += d;
    });
    const done = () => {
      resolve(
        new Set(
          out
            .split("\n")
            .map((l) => l.replace(/\/$/, ""))
            .filter(Boolean),
        ),
      );
    };
    git.on("error", () => {
      resolve(new Set());
    });
    git.on("close", done);
    git.stdin.end(dirs.map((d) => `${d}/`).join("\n") + "\n");
  });
}

/**
 * Every home beneath the opened folder, as paths from it with forward
 * slashes, sorted; the opened folder itself is always a home and isn't
 * listed.
 */
export async function findHomes(folder: string): Promise<string[]> {
  const root = path.resolve(folder);
  const homes: string[] = [];
  const walk = async (dir: string, repo: string | null, depth: number) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.map((e) => e.name));
    const isRepo = names.has(".git");
    const here = path.relative(root, dir).split(path.sep).join("/");
    if (here && (isRepo || names.has(".anur"))) homes.push(here);
    if (depth >= MAX_DEPTH) return;
    const nearestRepo = isRepo ? dir : repo;
    let subdirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
      .map((e) => path.join(dir, e.name));
    if (nearestRepo) {
      const rel = subdirs.map((d) => path.relative(nearestRepo, d).split(path.sep).join("/"));
      const ignored = await ignoredIn(nearestRepo, rel);
      subdirs = subdirs.filter((_, i) => !ignored.has(rel[i] ?? ""));
    }
    await Promise.all(subdirs.map((d) => walk(d, nearestRepo, depth + 1)));
  };
  await walk(root, null, 0);
  return homes.sort();
}

/**
 * A doc's home and its path there: the deepest home above it, else the
 * opened folder (""). `rel` is the doc's path from the opened folder.
 */
export function homeOf(rel: string, homes: readonly string[]): { home: string; inHome: string } {
  let best = "";
  for (const h of homes) if (h.length > best.length && rel.startsWith(`${h}/`)) best = h;
  return { home: best, inHome: best ? rel.slice(best.length + 1) : rel };
}

/** A path inside a home, as the opened folder sees it. */
export function fromHome(home: string, inHome: string): string {
  return home ? `${home}/${inHome}` : inHome;
}

/**
 * A home's own ID, kept in `.anur/home-id` and committed with it, so a doc's
 * ID is the same on every clone and at every level it's opened from. Made
 * the first time it's asked for, with the `.ignore` that keeps searches out.
 */
export async function homeIdOf(home: string): Promise<string> {
  const dir = path.join(home, ".anur");
  const file = path.join(dir, "home-id");
  const known = (await readFile(file, "utf8").catch(() => "")).trim();
  if (/^[a-f0-9]{32}$/.test(known)) return known;
  const id = randomUUID().replace(/-/g, "");
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${id}\n`);
  const ignore = path.join(dir, ".ignore");
  if ((await readFile(ignore, "utf8").catch(() => null)) === null) await writeFile(ignore, "*\n");
  return id;
}
