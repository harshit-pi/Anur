/**
 * The plugin API (group 19; Design - Engineering Plugin Internals, §2).
 * Seven points a plugin may register, each run in one process. The engineering
 * plugin is the first user; Core's own features move behind it in group 27.
 * Headless: no Electron or DOM, so the app, the hook and CI share it.
 */

/** The version of this API; a plugin built for a newer one is refused. */
export const API_VERSION = 1;

export type PointKind =
  | "section-source"
  | "edge-detector"
  | "context-provider"
  | "map-layer"
  | "surface"
  | "mcp-tools"
  | "decision-homes";

/** Where each point runs. A plugin loads in each process; only that process's points take effect there. */
export type PluginProcess = "index" | "main" | "renderer" | "mcp";

export const RUNS_IN: Record<PointKind, PluginProcess> = {
  "section-source": "index",
  "edge-detector": "index",
  "context-provider": "main",
  "map-layer": "renderer",
  surface: "main",
  "mcp-tools": "mcp",
  "decision-homes": "main",
};

/**
 * What a plugin declares before it loads. Registrations are checked against
 * it; network and file access aren't enforced until the sandbox (Extensions).
 */
export type PluginManifest = {
  id: string;
  name: string;
  /** One line a person reads in Settings → Plugins. */
  what: string;
  apiVersion: number;
  points: PointKind[];
  /** The prefix every MCP tool's name starts with, such as "eng_". */
  mcpPrefix?: string;
  /** Repo files whose fenced block the plugin writes, such as "CLAUDE.md". */
  surfaces?: string[];
  /** Folders it reads, relative to the opened folder; "." for all of it. */
  folders?: string[];
  network?: boolean;
};

/** A section from somewhere other than Markdown headings: a repo, a part. */
export type SourcedSection = {
  /** Stable across renames and moves; the source's own key. */
  id: string;
  path: string[];
  text: string;
  /** The parent's id, or null at the top. */
  parent: string | null;
};

export type SectionSource = {
  id: string;
  /** Whether this source has sections in the folder at all. */
  applies(folder: string): Promise<boolean>;
  sections(folder: string): Promise<SourcedSection[]>;
  /** Calls `onChange` when the folder's sections may have changed; returns a stop. */
  watch?(folder: string, onChange: () => void): () => void;
};

export type Edge = {
  /** Provider, consumer, kind and contract key (Internals §1); stable across rescans. */
  id: string;
  /** The consumer's section id. */
  from: string;
  /** The provider's section id, or a stub's: "stub:outside:<name>", "stub:not-cloned:<name>". */
  to: string;
  kind: string;
  /** The contract, as a person reads it: "GET /user/portfolios". */
  label: string;
  /** "found" when the code shows it; "guessed" when several providers might be the one. */
  how: "found" | "guessed";
  /** Where it was found, as "file:line" relative to the folder. */
  evidence: string | null;
  /** Where the provider declares it, when known. */
  declared: string | null;
  /** Earlier IDs of the same line, that saved decisions and choices may still use. */
  aliases?: string[];
};

export type EdgeDetector = {
  id: string;
  /** What it can't see, said to the person beside its edges. */
  misses: string[];
  /** Every edge it finds in the folder: a call is resolved across repos, so it reads them all. */
  edges(folder: string): Promise<Edge[]>;
};

/** Labelled lines a thread's bundle carries for its section. */
export type ContextProvider = {
  id: string;
  /** The heading the lines go under in the bundle. */
  label: string;
  provide(at: { folder: string; doc: string; section: string[] }): Promise<string[]>;
};

export type MapBox = { id: string; label: string; near: string[] | null };
export type MapLine = { from: string; to: string; label?: string };

export type MapLayer = {
  id: string;
  layer(at: { doc: string }): { boxes: MapBox[]; lines: MapLine[] };
};

/** A fenced block the plugin owns in a repo file; the rest of the file is never touched. */
export type Surface = {
  id: string;
  file: string;
  render(at: { folder: string }): Promise<string>;
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: unknown, at: { folder: string }): Promise<{ text: string } | { error: string }>;
};

/**
 * Places beyond the folder's own `.anur/` that hold committed decisions
 * (18.14): folder-relative dirs, each with its own `.anur/decisions/`. The
 * opened folder collects them all, so readers never ask a repo directly.
 */
export type DecisionHomes = {
  id: string;
  homes(folder: string): Promise<string[]>;
};

/** What a plugin gets in `onload`: one call per point it declared. */
export type PluginApi = {
  registerSectionSource(s: SectionSource): void;
  registerEdgeDetector(d: EdgeDetector): void;
  registerContextProvider(c: ContextProvider): void;
  registerMapLayer(m: MapLayer): void;
  registerSurface(s: Surface): void;
  registerMcpTool(t: McpTool): void;
  registerDecisionHomes(h: DecisionHomes): void;
};

export type Plugin = {
  manifest: PluginManifest;
  onload(api: PluginApi): void | Promise<void>;
  onunload?(): void | Promise<void>;
};
