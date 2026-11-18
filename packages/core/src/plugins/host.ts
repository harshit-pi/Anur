import {
  API_VERSION,
  RUNS_IN,
  type ContextProvider,
  type EdgeDetector,
  type MapLayer,
  type McpTool,
  type Plugin,
  type PluginApi,
  type PluginProcess,
  type PointKind,
  type SectionSource,
  type Surface,
} from "./api.ts";

type Registered = {
  "section-source": SectionSource;
  "edge-detector": EdgeDetector;
  "context-provider": ContextProvider;
  "map-layer": MapLayer;
  surface: Surface;
  "mcp-tools": McpTool;
};

/** Why a plugin, or one of its registrations, was refused. */
export class PluginRefused extends Error {}

const SURFACE_FILE = /^[\w./-]+$/;

/**
 * Loads plugins in one process and keeps what they register (group 19).
 * Every registration is checked against the plugin's manifest; points that
 * run in another process are accepted and left for that process's host.
 * Unloading a plugin removes everything it registered.
 */
export class PluginHost {
  private readonly loaded = new Map<string, Plugin>();
  private readonly regs = new Map<string, { kind: PointKind; value: Registered[PointKind] }[]>();

  /** The process this host runs in; only that process's points are kept here. */
  private readonly where: PluginProcess;

  constructor(where: PluginProcess) {
    this.where = where;
  }

  /** Refuses a plugin built for a newer API, or one already loaded. */
  async load(plugin: Plugin): Promise<void> {
    const m = plugin.manifest;
    if (!/^[a-z][a-z0-9-]*$/.test(m.id)) throw new PluginRefused(`"${m.id}" isn't a plugin id.`);
    if (this.loaded.has(m.id)) throw new PluginRefused(`${m.name} is already on.`);
    if (m.apiVersion > API_VERSION)
      throw new PluginRefused(`${m.name} needs a newer Anur (plugin API ${String(m.apiVersion)}).`);
    if (m.points.includes("mcp-tools") && !/^[a-z]+_$/.test(m.mcpPrefix ?? ""))
      throw new PluginRefused(`${m.name} adds MCP tools but declares no prefix such as "eng_".`);
    if (m.mcpPrefix === "anur_") throw new PluginRefused(`"anur_" is Anur's own prefix.`);
    for (const f of m.surfaces ?? [])
      if (!SURFACE_FILE.test(f) || f.split("/").includes(".."))
        throw new PluginRefused(`${m.name} declares a surface outside the folder: ${f}.`);
    this.loaded.set(m.id, plugin);
    this.regs.set(m.id, []);
    try {
      await plugin.onload(this.apiFor(plugin));
    } catch (e) {
      await this.unload(m.id);
      throw e instanceof PluginRefused
        ? e
        : new PluginRefused(`${m.name} failed to load: ${String(e)}`);
    }
  }

  async unload(id: string): Promise<void> {
    const plugin = this.loaded.get(id);
    if (!plugin) return;
    this.loaded.delete(id);
    this.regs.delete(id);
    await plugin.onunload?.();
  }

  plugins(): Plugin[] {
    return [...this.loaded.values()];
  }

  private apiFor(plugin: Plugin): PluginApi {
    const m = plugin.manifest;
    const add = <K extends PointKind>(kind: K, value: Registered[K]) => {
      if (!m.points.includes(kind))
        throw new PluginRefused(`${m.name} registered a ${kind} its manifest didn't declare.`);
      if (kind === "mcp-tools" && !(value as McpTool).name.startsWith(m.mcpPrefix ?? "\u0000"))
        throw new PluginRefused(
          `${m.name}'s tool ${(value as McpTool).name} must start with ${m.mcpPrefix ?? ""}.`,
        );
      if (kind === "surface" && !(m.surfaces ?? []).includes((value as Surface).file))
        throw new PluginRefused(
          `${m.name} writes ${(value as Surface).file}, which its manifest didn't declare.`,
        );
      // Another process's point: checked here, kept there.
      if (RUNS_IN[kind] !== this.where) return;
      this.regs.get(m.id)?.push({ kind, value });
    };
    return {
      registerSectionSource: (s) => {
        add("section-source", s);
      },
      registerEdgeDetector: (d) => {
        add("edge-detector", d);
      },
      registerContextProvider: (c) => {
        add("context-provider", c);
      },
      registerMapLayer: (l) => {
        add("map-layer", l);
      },
      registerSurface: (s) => {
        add("surface", s);
      },
      registerMcpTool: (t) => {
        add("mcp-tools", t);
      },
    };
  }

  private all<K extends PointKind>(kind: K): Registered[K][] {
    return [...this.regs.values()].flatMap((rs) =>
      rs.filter((r) => r.kind === kind).map((r) => r.value as Registered[K]),
    );
  }

  sectionSources(): SectionSource[] {
    return this.all("section-source");
  }
  edgeDetectors(): EdgeDetector[] {
    return this.all("edge-detector");
  }
  contextProviders(): ContextProvider[] {
    return this.all("context-provider");
  }
  mapLayers(): MapLayer[] {
    return this.all("map-layer");
  }
  surfaces(): Surface[] {
    return this.all("surface");
  }
  mcpTools(): McpTool[] {
    return this.all("mcp-tools");
  }
}
