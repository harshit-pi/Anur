import { PluginHost, type SourcedSection } from "@anur/core";
import { pluginById } from "../../plugins/index.ts";

/**
 * The index process's own plugin hosts, one per folder (Internals §2: section
 * sources and edge detectors run here, never in main). Kept in step with the
 * plugins switched on, as main's own hosts are.
 */
const hosts = new Map<string, PluginHost>();

async function hostFor(folder: string, plugins: string[]): Promise<PluginHost> {
  let host = hosts.get(folder);
  if (!host) {
    host = new PluginHost("index");
    hosts.set(folder, host);
  }
  const want = new Set(plugins);
  for (const p of host.plugins()) if (!want.has(p.manifest.id)) await host.unload(p.manifest.id);
  const have = new Set(host.plugins().map((p) => p.manifest.id));
  for (const id of want) {
    const p = pluginById(id);
    if (p && !have.has(id)) await host.load(p);
  }
  return host;
}

/** Each folder's watchers, by source, started the first time it is read. */
const watching = new Map<string, Map<string, () => void>>();

/**
 * Sections from every source that applies to the folder. Each source that
 * watches starts once, and `onChange` says the folder should be read again.
 */
export async function sectionsFor(
  folder: string,
  plugins: string[],
  onChange: (folder: string) => void = () => undefined,
): Promise<{ id: string; sections: SourcedSection[] }[]> {
  const host = await hostFor(folder, plugins);
  const sources = host.sectionSources();
  const stops = watching.get(folder) ?? new Map<string, () => void>();
  watching.set(folder, stops);
  // A source whose plugin was switched off stops watching.
  for (const [id, stop] of stops)
    if (!sources.some((s) => s.id === id)) {
      stop();
      stops.delete(id);
    }
  const out: { id: string; sections: SourcedSection[] }[] = [];
  for (const s of sources) {
    if (!(await s.applies(folder))) continue;
    out.push({ id: s.id, sections: await s.sections(folder) });
    if (s.watch && !stops.has(s.id))
      stops.set(
        s.id,
        s.watch(folder, () => {
          onChange(folder);
        }),
      );
  }
  return out;
}
