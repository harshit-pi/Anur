import { API_VERSION, type Plugin, type SourcedSection } from "@anur/core";
import { findRepoDirs, scanSystem } from "@anur/system";

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
    });
  },
};

/** A folder's repos, each a section, with its parts as sections beneath it. */
export function systemSections(folder: string): SourcedSection[] {
  const scan = scanSystem(folder);
  const out: SourcedSection[] = [];
  for (const r of scan.repos) {
    const repoId = `repo:${r.id ?? r.dir}`;
    out.push({ id: repoId, path: [r.dir], text: r.github ?? "", parent: null });
    for (const p of scan.parts.filter((x) => x.repo === r.dir))
      out.push({
        id: `part:${p.id}`,
        path: [r.dir, p.name],
        text: `${p.kind} in ${p.file}`,
        parent: repoId,
      });
  }
  return out;
}
