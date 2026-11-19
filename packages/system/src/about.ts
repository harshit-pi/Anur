import path from "node:path";
import { edgesIn } from "./edges.ts";
import { scanSystem } from "./system.ts";
import type { Part } from "./parts.ts";
import { partOf } from "./tasks.ts";

/**
 * What a decision is about, from the files the work touched (23.1): the one
 * part holding them all, or the line between the two parts they span. A
 * decision on a part reaches work in that part; one on a line, work on
 * either end. Null when the files sit in no part, or in parts no known line
 * joins: then the decision is the repo's, as before.
 */
export type About =
  | {
      kind: "part";
      scope: `part:${string}`;
      /** The part's name, as the map shows it. */
      on: string;
      repo: string;
      /** The folder the part covers, relative to the opened folder; "" for the whole repo. */
      dir: string;
    }
  | {
      kind: "edge";
      scope: `edge:${string}`;
      /** "<caller> → <provider>: <route>". */
      on: string;
      repo: string;
    };

/** Files given absolute or relative to `cwd`, as paths from `folder`; ones outside it dropped. */
export function filesFrom(folder: string, cwd: string, files: readonly string[]): string[] {
  return files.flatMap((f) => {
    const rel = path.relative(folder, path.resolve(cwd, f)).split(path.sep).join("/");
    return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? [rel] : [];
  });
}

/** The part or line these files (relative to `folder`) are about; null when there's none. */
export function aboutFiles(folder: string, files: readonly string[]): About | null {
  if (!files.length) return null;
  const scan = scanSystem(folder);
  // Deepest repo first, so a submodule's files are its own.
  const repos = [...scan.repos].sort((a, b) => b.dir.length - a.dir.length);
  const repoOf = (f: string) =>
    repos.find((r) => r.dir === "." || f === r.dir || f.startsWith(`${r.dir}/`))?.dir ?? null;
  // Each file's end: its part, else its repo when no part holds it.
  const hit = new Map<string, { repo: string; part: Part | null }>();
  // "file:line" names a call or a route's declaration exactly.
  const paths = files.map((f) => f.replace(/:\d+$/, ""));
  for (const f of paths) {
    const repo = repoOf(f);
    if (repo === null) return null;
    const name = partOf(scan.parts, repo, f);
    const part = (name && scan.parts.find((p) => p.repo === repo && p.name === name)) || null;
    hit.set(`${repo}\u0000${part?.id ?? ""}`, { repo, part });
  }
  const [a, b, more] = [...hit.values()];
  if (!a || more) return null;
  if (!b) {
    if (!a.part) return null;
    const dir = path.posix.dirname(a.part.file);
    return {
      kind: "part",
      scope: `part:${a.part.id}`,
      on: a.part.name,
      repo: a.repo,
      dir: dir === "." ? "" : dir,
    };
  }
  const ends = (x: { repo: string; part: string | null }, p: typeof a) =>
    x.repo === p.repo && x.part === (p.part?.name ?? null);
  const between = edgesIn(
    folder,
    scan.repos.map((r) => r.dir),
    scan.parts,
  ).filter(
    (e) =>
      "repo" in e.to && ((ends(e.from, a) && ends(e.to, b)) || (ends(e.from, b) && ends(e.to, a))),
  );
  // Two parts often share many routes: the one whose call or declaration
  // the files name, by line, else by file.
  const exact = between.filter(
    (e) => files.includes(e.evidence) || files.includes(e.declared ?? ""),
  );
  const byFile = between.filter((e) =>
    [e.evidence, e.declared].some((w) => w !== null && paths.includes(w.replace(/:\d+$/, ""))),
  );
  const edge = [between, exact, byFile].find((l) => l.length === 1)?.[0];
  if (!edge || !("repo" in edge.to)) return null;
  const route = `${edge.method ? `${edge.method} ` : ""}${edge.route}`;
  return {
    kind: "edge",
    scope: `edge:${edge.id}`,
    on: `${edge.from.part ?? edge.from.repo} → ${edge.to.part ?? edge.to.repo}: ${route}`,
    // The provider's repo: its side owns a line's decisions.
    repo: edge.to.repo,
  };
}
