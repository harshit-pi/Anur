import { describe, expect, it } from "vitest";
import { API_VERSION, type Plugin, type PluginManifest } from "./api.ts";
import { PluginHost, PluginRefused } from "./host.ts";

const manifest = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: "test",
  name: "Test plugin",
  what: "For tests.",
  apiVersion: API_VERSION,
  points: ["section-source", "context-provider", "map-layer", "mcp-tools"],
  mcpPrefix: "tst_",
  ...over,
});

/** Adds one of each of the four points the done-when names. */
const fourPoints = (m = manifest()): Plugin => ({
  manifest: m,
  onload(api) {
    api.registerSectionSource({
      id: "repos",
      applies: () => Promise.resolve(true),
      sections: () => Promise.resolve([{ id: "r1", path: ["Repo"], text: "", parent: null }]),
    });
    api.registerContextProvider({
      id: "decisions",
      label: "Decided on this part",
      provide: () => Promise.resolve(["- Three retries, not infinite."]),
    });
    api.registerMapLayer({
      id: "system",
      layer: () => ({ boxes: [{ id: "b", label: "Repo", near: null }], lines: [] }),
    });
    api.registerMcpTool({
      name: "tst_parts",
      description: "Lists parts.",
      inputSchema: { type: "object" },
      call: () => Promise.resolve({ text: "Repo" }),
    });
  },
});

const hosts = () => ({
  index: new PluginHost("index"),
  main: new PluginHost("main"),
  renderer: new PluginHost("renderer"),
  mcp: new PluginHost("mcp"),
});

describe("PluginHost", () => {
  it("adds each point in the process it runs in, and removing the plugin removes all four", async () => {
    const h = hosts();
    for (const host of Object.values(h)) await host.load(fourPoints());
    expect(h.index.sectionSources().map((s) => s.id)).toEqual(["repos"]);
    expect(h.main.contextProviders().map((c) => c.label)).toEqual(["Decided on this part"]);
    expect(h.renderer.mapLayers().map((l) => l.id)).toEqual(["system"]);
    expect(h.mcp.mcpTools().map((t) => t.name)).toEqual(["tst_parts"]);
    // Points belong to one process each: main holds no map layer.
    expect(h.main.mapLayers()).toEqual([]);
    for (const host of Object.values(h)) await host.unload("test");
    expect([
      h.index.sectionSources(),
      h.main.contextProviders(),
      h.renderer.mapLayers(),
      h.mcp.mcpTools(),
    ]).toEqual([[], [], [], []]);
  });

  it("refuses a registration the manifest didn't declare, and leaves nothing behind", async () => {
    const host = new PluginHost("main");
    const p = fourPoints(manifest({ points: ["section-source"] }));
    await expect(host.load(p)).rejects.toThrow(PluginRefused);
    await expect(host.load(p)).rejects.toThrow(/didn't declare/);
    expect(host.plugins()).toEqual([]);
    expect(host.contextProviders()).toEqual([]);
  });

  it("refuses a newer API, a tool outside its prefix, and an undeclared surface", async () => {
    const host = new PluginHost("main");
    await expect(host.load(fourPoints(manifest({ apiVersion: API_VERSION + 1 })))).rejects.toThrow(
      /newer Anur/,
    );
    await expect(host.load(fourPoints(manifest({ mcpPrefix: "eng_" })))).rejects.toThrow(
      /must start with eng_/,
    );
    await expect(host.load(fourPoints(manifest({ mcpPrefix: "anur_" })))).rejects.toThrow(
      /Anur's own prefix/,
    );
    const writer: Plugin = {
      manifest: manifest({ points: ["surface"], surfaces: ["CLAUDE.md"] }),
      onload(api) {
        api.registerSurface({ id: "s", file: "AGENTS.md", render: () => Promise.resolve("") });
      },
    };
    await expect(host.load(writer)).rejects.toThrow(/AGENTS.md, which its manifest didn't declare/);
    await expect(
      host.load({ ...writer, manifest: manifest({ points: ["surface"], surfaces: ["../x"] }) }),
    ).rejects.toThrow(/outside the folder/);
  });

  it("runs onunload, and won't load the same plugin twice", async () => {
    const host = new PluginHost("main");
    let unloaded = 0;
    const p: Plugin = {
      manifest: manifest({ points: [] }),
      onload() {},
      onunload() {
        unloaded++;
      },
    };
    await host.load(p);
    await expect(host.load(p)).rejects.toThrow(/already on/);
    await host.unload("test");
    expect(unloaded).toBe(1);
  });
});
