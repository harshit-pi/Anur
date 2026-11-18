import { findRepos, type Repo, type ScanProblem } from "./repos.ts";
import {
  assignPartIds,
  knownFrom,
  partsOf,
  type IdLine,
  type KnownPart,
  type Part,
} from "./parts.ts";

export type SystemScan = {
  repos: Repo[];
  parts: Part[];
  problems: ScanProblem[];
  lines: IdLine[];
  known: KnownPart[];
};

/** Scan a folder of repos: repos, parts by rule, IDs against what was known, and what went wrong. */
export function scanSystem(
  folder: string,
  opts: { pin?: boolean; known?: readonly KnownPart[] } = {},
): SystemScan {
  const { repos, problems } = findRepos(folder, { pin: opts.pin ?? false });
  const order = { package: 0, stack: 1, service: 2 };
  // A fixed order: by repo, then packages, stacks and services, then name.
  const found = repos
    .flatMap((r) => partsOf(folder, r, problems))
    .sort(
      (a, b) =>
        a.repo.localeCompare(b.repo) ||
        order[a.kind] - order[b.kind] ||
        a.name.localeCompare(b.name),
    );
  const repoIds = new Map(repos.flatMap((r) => (r.id ? [[r.dir, r.id] as const] : [])));
  for (const r of repos)
    if (!r.id)
      problems.push({ where: r.dir, what: "Its parts have no IDs until the repo has one" });
  const { parts, lines } = assignPartIds(found, repoIds, opts.known ?? []);
  return { repos, parts, problems, lines, known: knownFrom(parts, repoIds) };
}
