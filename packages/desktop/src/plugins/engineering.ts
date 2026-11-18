import { API_VERSION, type Plugin } from "@anur/core";

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
  onload() {
    // Groups 20 to 25 register its section source, detectors, context, map, surfaces and tools.
  },
};
