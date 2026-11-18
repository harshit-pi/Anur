/**
 * Parts from build files, by rule, and their IDs (group 20; Internals §1).
 * A part is a package, a CDK stack or a service. Its ID is the repo's ID
 * plus its declared name, never a path, so moves within a repo keep it; a
 * new name in the same build file is a rename, which keeps it too.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { SKIP_DIRS, shortHash, type Repo, type ScanProblem } from "./repos.ts";

export type PartKind = "package" | "stack" | "service";

export type FoundPart = {
  repo: string;
  kind: PartKind;
  /** The declared name: the package name, CDK construct ID or service name. */
  name: string;
  /** The build file it was read from, relative to the opened folder. */
  file: string;
};

const CONFLICT = /^(<{7}|>{7}) /m;

/** Build files under a repo, skipping nested repos and the usual output folders. */
function buildFiles(repoAbs: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, top: boolean) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    if (!top && names.includes(".git")) return; // A nested repo: its own parts.
    for (const n of names) {
      const p = path.join(dir, n);
      if (
        /^(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|serverless\.ya?ml|cdk\.json)$/.test(n)
      ) {
        out.push(p);
        continue;
      }
      if (SKIP_DIRS.has(n) || n.startsWith(".")) continue;
      try {
        if (statSync(p).isDirectory()) walk(p, false);
      } catch {
        // Unreadable: skipped.
      }
    }
  };
  walk(repoAbs, true);
  return out.sort();
}

/**
 * CDK stacks an app file creates: `new FooStack(app, "Name")` in TypeScript,
 * or `FooStack(app, "Name")` in Python, across lines. A name built at run
 * time, such as an f-string, can't be read and is left out.
 */
function stacksIn(text: string): string[] {
  return [
    ...text.matchAll(
      /(?:new\s+)?(\w*Stack)\s*\(\s*(?:app|this|scope|self)\s*,\s*(?:id\s*=\s*)?['"`]([\w-]+)['"`]/g,
    ),
  ].map((m) => m[2] ?? "");
}

/** The parts one repo declares. A build file that won't parse is skipped and listed. */
export function partsOf(folder: string, repo: Repo, problems: ScanProblem[]): FoundPart[] {
  const repoAbs = path.join(folder, repo.dir);
  const out: FoundPart[] = [];
  for (const abs of buildFiles(repoAbs)) {
    const file = path.relative(folder, abs);
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (CONFLICT.test(text)) {
      problems.push({
        where: file,
        what: "Has merge conflict markers; skipped until they're resolved",
      });
      continue;
    }
    const base = path.basename(abs);
    const add = (kind: PartKind, name: string | undefined) => {
      if (name) out.push({ repo: repo.dir, kind, name, file });
    };
    try {
      if (base === "package.json") {
        const j = JSON.parse(text) as { name?: unknown; workspaces?: unknown };
        // A monorepo's root only lists its workspaces: the repo itself, not a part.
        if (j.workspaces && path.dirname(abs) === repoAbs) continue;
        if (typeof j.name === "string") add("package", j.name);
        else problems.push({ where: file, what: "A package.json without a name; skipped" });
      } else if (base === "pyproject.toml") {
        add("package", /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text)?.[1]);
      } else if (base === "go.mod") {
        add("package", /^module\s+(\S+)/m.exec(text)?.[1]);
      } else if (base === "Cargo.toml") {
        add("package", /\[package\][^[]*?name\s*=\s*["']([^"']+)["']/.exec(text)?.[1]);
      } else if (/^serverless\.ya?ml$/.test(base)) {
        add("service", /^service:\s*['"]?([\w-]+)/m.exec(text)?.[1]);
      } else if (base === "cdk.json") {
        const app = (JSON.parse(text) as { app?: unknown }).app;
        const entry =
          typeof app === "string" ? /([\w./-]+\.(?:ts|js|mjs|py))/.exec(app)?.[1] : undefined;
        if (!entry) continue;
        const appText = readFileSync(path.join(path.dirname(abs), entry), "utf8");
        for (const name of stacksIn(appText))
          out.push({
            repo: repo.dir,
            kind: "stack",
            name,
            file: path.join(path.dirname(file), entry),
          });
      }
    } catch {
      problems.push({ where: file, what: "Can't be parsed; skipped" });
    }
  }
  return out;
}

export type Part = FoundPart & { id: string };

/** What a part's ID was last time, by its build file and kind, to follow renames. */
export type KnownPart = { id: string; repoId: string; kind: PartKind; name: string; file: string };

export type IdLine =
  | { kind: "mint"; id: string; repoId: string; name: string; file: string }
  | { kind: "rename"; id: string; from: string; to: string; file: string }
  | { kind: "orphaned"; id: string; name: string; suggest: string | null };

const keyOf = (repoId: string, name: string) => shortHash(repoId, name);

/**
 * IDs for the parts found, against what was known: the declared name keeps
 * an ID through a move; the same build file with a new name keeps it as a
 * rename; two parts with one name add their folder. A known part not found
 * again is orphaned, with the closest new part as a suggestion.
 */
export function assignPartIds(
  found: readonly FoundPart[],
  repoIds: ReadonlyMap<string, string>,
  known: readonly KnownPart[],
): { parts: Part[]; lines: IdLine[] } {
  const lines: IdLine[] = [];
  const parts: Part[] = [];
  const used = new Set<string>();
  const dupes = new Map<string, number>();
  for (const f of found) {
    const r = repoIds.get(f.repo);
    if (r) dupes.set(`${r}\u0000${f.name}`, (dupes.get(`${r}\u0000${f.name}`) ?? 0) + 1);
  }
  for (const f of found) {
    const repoId = repoIds.get(f.repo);
    if (!repoId) continue;
    const same = (dupes.get(`${repoId}\u0000${f.name}`) ?? 0) > 1;
    const natural = same ? shortHash(repoId, f.name, path.dirname(f.file)) : keyOf(repoId, f.name);
    const byName = known.find((k) => k.id === natural);
    const byFile = known.find(
      (k) => k.repoId === repoId && k.kind === f.kind && k.file === f.file && k.name !== f.name,
    );
    let id = natural;
    if (
      !byName &&
      byFile &&
      !found.some((o) => o !== f && o.name === byFile.name && repoIds.get(o.repo) === repoId)
    ) {
      id = byFile.id;
      lines.push({ kind: "rename", id, from: byFile.name, to: f.name, file: f.file });
    } else if (!byName) {
      lines.push({ kind: "mint", id, repoId, name: f.name, file: f.file });
    }
    used.add(id);
    parts.push({ ...f, id });
  }
  for (const k of known) {
    if (used.has(k.id)) continue;
    const suggest = parts.find((p) => p.name === k.name) ?? null;
    lines.push({ kind: "orphaned", id: k.id, name: k.name, suggest: suggest?.id ?? null });
  }
  return { parts, lines };
}

/** The known state after a scan, to pass to the next one. */
export function knownFrom(
  parts: readonly Part[],
  repoIds: ReadonlyMap<string, string>,
): KnownPart[] {
  return parts.flatMap((p) => {
    const repoId = repoIds.get(p.repo);
    return repoId ? [{ id: p.id, repoId, kind: p.kind, name: p.name, file: p.file }] : [];
  });
}
