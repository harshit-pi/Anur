import { API_VERSION, type Edge, type Plugin, type SourcedSection } from "@anur/core";
import {
  HTTP_MISSES,
  applyReview,
  edgesIn,
  findRepoDirs,
  groupParts,
  readReview,
  reviewState,
  scanSystem,
  watchSystem,
  type PartGroup,
} from "@anur/system";

/**
 * The engineering plugin (Design - Engineering Plugin): a system across
 * repos, the change report, decisions on parts and edges. Group 19 declares
 * it; its points arrive with groups 20 to 25.
 */
export const engineering: Plugin = {
  manifest: {
    id: "engineering",
    name: "Engineering",
    what: "For a folder of code repos: after each task, what the change touched across repos, ranked by risk, with Claude's choices and any decision it goes against.",
    apiVersion: API_VERSION,
    points: [
      "section-source",
      "edge-detector",
      "context-provider",
      "map-layer",
      "surface",
      "mcp-tools",
    ],
    mcpPrefix: "eng_",
    surfaces: ["CLAUDE.md", "CLAUDE.local.md"],
    folders: ["."],
    network: false,
  },
  onload(api) {
    // Repos and their parts as sections (group 20); the rest arrive with groups 21 to 25.
    api.registerSectionSource({
      id: "system",
      applies: (folder) => Promise.resolve(findRepoDirs(folder).length > 0),
      sections: (folder) => Promise.resolve(systemSections(folder)),
      // One watcher per repo (20.8): a build file's change reads the system again.
      watch: (folder, onChange) => watchSystem(folder, onChange),
    });
    // Calls from one repo to another's HTTP routes (group 22).
    api.registerEdgeDetector({
      id: "http",
      misses: HTTP_MISSES,
      edges: (folder) => Promise.resolve(systemEdges(folder)),
    });
  },
};

/**
 * A folder's repos, each a section, with its parts beneath it. A repo with
 * more than twelve parts puts groups between, by rule (`groupParts`), so the
 * map opens one level at a time; a part's ID and path never change with them.
 */
export function systemSections(folder: string): SourcedSection[] {
  const scan = scanSystem(folder);
  // The person's names and merges for groups (20.6), applied over the rule's.
  const review = reviewState(readReview(folder));
  const out: SourcedSection[] = [];
  // One system per GitHub owner when the folder holds several: each owner's
  // repos sit under it, and a map is drawn per owner. Repos without a remote
  // share "No remote".
  const ownerOf = (github: string | null) => github?.split("/")[0] ?? "No remote";
  const owners = [...new Set(scan.repos.map((r) => ownerOf(r.github)))];
  const byOwner = owners.length > 1;
  if (byOwner)
    for (const o of owners.sort((a, b) =>
      a === "No remote"
        ? 1
        : b === "No remote"
          ? -1
          : a.localeCompare(b, undefined, { sensitivity: "base" }),
    ))
      out.push({ id: `org:${o}`, path: [o], text: "", parent: null });
  for (const r of scan.repos) {
    const repoId = `repo:${r.id ?? r.dir}`;
    out.push({
      id: repoId,
      path: [r.dir],
      text: r.github ?? "",
      parent: byOwner ? `org:${ownerOf(r.github)}` : null,
    });
    const parts = scan.parts.filter((x) => x.repo === r.dir);
    // Two parts may share a name; each is placed once, in order.
    const left = [...parts];
    const partSection = (name: string, parent: string) => {
      const i = left.findIndex((x) => x.name === name);
      if (i < 0) return;
      const p = left.splice(i, 1)[0];
      if (!p) return;
      out.push({
        id: `part:${p.id}`,
        path: [r.dir, p.name],
        text: `${p.kind} in ${p.file}`,
        parent,
      });
    };
    const place = (groups: PartGroup[], parent: string, trail: string[]) => {
      for (const g of groups) {
        const id = `group:${r.id ?? r.dir}/${g.key}`;
        out.push({
          id,
          path: [r.dir, ...trail, g.name],
          text: `${String(g.parts.length)} parts, grouped by name`,
          parent,
        });
        if (g.groups) place(g.groups, id, [...trail, g.name]);
        else for (const n of g.parts) partSection(n, id);
      }
    };
    const ruled = groupParts(parts.map((p) => p.name));
    const groups = ruled
      ? applyReview(ruled, (key) => `group:${r.id ?? r.dir}/${key}`, review)
      : null;
    if (groups) place(groups, repoId, []);
    for (const p of [...left]) partSection(p.name, repoId);
  }
  return out;
}

/**
 * The folder's HTTP edges as sections' edges: each end the part that holds
 * the file, else its repo; an outside service or a repo not cloned, a stub.
 */
export function systemEdges(folder: string): Edge[] {
  const scan = scanSystem(folder);
  const repoId = (dir: string) => `repo:${scan.repos.find((r) => r.dir === dir)?.id ?? dir}`;
  const end = (repo: string, part: string | null) => {
    const p = part ? scan.parts.find((x) => x.repo === repo && x.name === part) : undefined;
    return p ? `part:${p.id}` : repoId(repo);
  };
  return edgesIn(
    folder,
    scan.repos.map((r) => r.dir),
    scan.parts,
  ).map((e) => ({
    id: e.id,
    from: end(e.from.repo, e.from.part),
    to:
      "repo" in e.to
        ? end(e.to.repo, e.to.part)
        : `stub:${e.to.stub === "outside" ? "outside" : "not-cloned"}:${e.to.name}`,
    kind: e.kind,
    label: `${e.method ? `${e.method} ` : ""}${e.route}`,
    how: e.how,
    evidence: e.evidence,
    declared: e.declared,
  }));
}
