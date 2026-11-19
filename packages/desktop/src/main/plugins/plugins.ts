import { homedir } from "node:os";
import path from "node:path";
import type { FeedPlugin, OpenFromItem, PluginContext, PluginStatus } from "@anur/core";
import { PluginStore, readFeed, type Installed } from "./store.ts";
import {
  keptOnMac,
  readFolderPlugins,
  setKeptOnMac,
  writeEnabled,
  writeValues,
  type FolderPlugins,
  type Value,
} from "./folder-config.ts";
import { PluginRuntime, loadModule, runWith } from "./runtime.ts";

/**
 * Downloaded plugins in the app (Plugins and Git mock): the marketplace's
 * list, installing one and switching it on at once, each folder's settings,
 * running each plugin for every folder it's on in, and updating them all by
 * themselves unless the person turned that off.
 */

export type PluginsDeps = {
  dir: string;
  /** Folders open now. */
  openFolders: () => string[];
  person: (folder: string) => Promise<{ name: string; handle: string | null }>;
  path: () => Promise<string>;
  status: (folder: string, plugin: string, s: PluginStatus | null) => void;
  notify: (folder: string, text: string, tone: "info" | "warn") => void;
  filesChanged: (folder: string) => void;
  autoUpdate: () => boolean;
  feed?: string;
  /** The key the feed must be signed with; Anur's own unless a test brings one. */
  key?: string;
};

export const inICloud = (folder: string) =>
  folder.includes(`${path.sep}Library${path.sep}Mobile Documents${path.sep}`);

export class Plugins {
  readonly store: PluginStore;
  private readonly runtime = new PluginRuntime();
  /** Each open folder's plugin files, as last read. */
  private readonly folders = new Map<string, FolderPlugins>();
  private feedCache: { at: number; plugins: FeedPlugin[] } | null = null;

  constructor(private readonly d: PluginsDeps) {
    this.store = new PluginStore(d.dir);
  }

  /** A folder's plugin files, read once, then kept as they're changed here. */
  private async config(folder: string): Promise<FolderPlugins> {
    let c = this.folders.get(folder);
    if (!c) {
      c = await readFolderPlugins(folder);
      this.folders.set(folder, c);
    }
    return c;
  }

  /** The plugins on for a folder, from its own `.anur/plugins/enabled.json`. */
  async onIn(folder: string): Promise<string[]> {
    return [...(await this.config(folder)).on];
  }

  /** The feed's plugins, read at most once a minute. */
  async feed(fresh = false): Promise<FeedPlugin[]> {
    if (!fresh && this.feedCache && Date.now() - this.feedCache.at < 60_000)
      return this.feedCache.plugins;
    const plugins = await readFeed(this.d.feed, this.d.key);
    this.feedCache = { at: Date.now(), plugins };
    return plugins;
  }

  installed(): Promise<Record<string, Installed>> {
    return this.store.load();
  }

  /** A folder's value of a plugin's setting, else its default. */
  value(folder: string, p: FeedPlugin, key: string): Value {
    const set = this.folders.get(folder)?.values[p.id]?.[key];
    if (set !== undefined) return set;
    const def = p.settings.find((s) => s.key === key);
    return def ? def.default : false;
  }

  /** Saves a setting in the folder's `.anur/plugins/<id>.json`. */
  async setValue(folder: string, id: string, key: string, value: Value): Promise<void> {
    const c = await this.config(folder);
    const now = { ...(c.values[id] ?? {}), [key]: value };
    c.values[id] = now;
    await writeValues(folder, id, now);
    this.runtime.settingsChanged(folder, id);
  }

  /**
   * Starts every plugin the folder has on. One it names that this Mac doesn't
   * have yet, as in a teammate's folder, is installed from the feed first.
   */
  async startFolder(folder: string): Promise<void> {
    this.folders.delete(folder);
    const c = await this.config(folder);
    let have = await this.installed();
    for (const id of c.on) {
      if (!have[id]) {
        const got = await this.installFromFeed(id).catch(() => null);
        if (!got) continue;
        have = await this.installed();
        this.d.notify(folder, `Installed ${got.name}, which this folder uses.`, "info");
      }
      const p = have[id];
      if (p)
        await this.start(folder, p).catch((e: unknown) => {
          this.d.notify(
            folder,
            `${p.name} couldn't start: ${e instanceof Error ? e.message : String(e)}`,
            "warn",
          );
        });
    }
  }

  /** The folder's plugin files changed, as after a pull: what's on and how follows them. */
  async reloadFolder(folder: string): Promise<void> {
    const was = this.folders.get(folder);
    if (!was) return;
    const now = await readFolderPlugins(folder);
    this.folders.set(folder, now);
    for (const id of was.on) if (!now.on.includes(id)) await this.runtime.stop(folder, id);
    const have = await this.installed();
    for (const id of now.on) {
      const p = have[id];
      if (!p) continue;
      if (!this.runtime.isRunning(folder, id)) await this.start(folder, p).catch(() => undefined);
      else if (JSON.stringify(was.values[id]) !== JSON.stringify(now.values[id]))
        this.runtime.settingsChanged(folder, id);
    }
  }

  /** Whether a plugin's settings stay on this Mac rather than going with the folder. */
  keptOnMac(folder: string, id: string): Promise<boolean> {
    return keptOnMac(folder, id);
  }

  setKeptOnMac(folder: string, id: string, onMac: boolean): Promise<void> {
    return setKeptOnMac(folder, id, onMac);
  }

  private async installFromFeed(id: string): Promise<Installed> {
    const p = (await this.feed(true)).find((x) => x.id === id);
    if (!p) throw new Error(`The feed has no plugin "${id}".`);
    return this.store.install(p, this.d.feed);
  }

  private async start(folder: string, p: Installed): Promise<void> {
    const file = this.store.fileOf(p.id);
    if (!file) return;
    const person = await this.d.person(folder);
    const host = {
      folder,
      inICloud: inICloud(folder),
      person,
      path: this.d.path,
      setting: ((key: string) => this.value(folder, p, key)) as PluginContext["setting"],
      setSetting: (key: string, value: Value) => this.setValue(folder, p.id, key, value),
      status: (plugin: string, st: PluginStatus | null) => {
        this.d.status(folder, plugin, st);
      },
      notify: (text: string, tone: "info" | "warn" = "info") => {
        this.d.notify(folder, text, tone);
      },
      filesChanged: () => {
        this.d.filesChanged(folder);
      },
    };
    await this.runtime.start(folder, p, file, host);
  }

  /** Before a folder's window goes: its plugins' quit work, then stop them. */
  async closeFolder(folder: string, ms = 3500): Promise<void> {
    await this.runtime.quitFolder(folder, ms);
    await this.runtime.stopFolder(folder);
  }

  /** Installs from the feed, switches it on for `folder` and starts it, all at once. */
  async install(id: string, folder: string | null): Promise<Installed> {
    const got = await this.installFromFeed(id);
    if (folder) await this.setOn(folder, id, true);
    return got;
  }

  async uninstall(id: string): Promise<void> {
    for (const folder of this.d.openFolders()) {
      await this.runtime.stop(folder, id);
      this.d.status(folder, id, null);
    }
    await this.store.uninstall(id);
  }

  /** Switches a plugin on or off in the folder's `.anur/plugins/enabled.json`. */
  async setOn(folder: string, id: string, on: boolean): Promise<void> {
    const c = await this.config(folder);
    c.on = [...c.on.filter((x) => x !== id), ...(on ? [id] : [])];
    await writeEnabled(folder, c.on);
    if (!on) {
      await this.runtime.stop(folder, id);
      this.d.status(folder, id, null);
      return;
    }
    const p = (await this.installed())[id];
    if (p) await this.start(folder, p);
  }

  action(folder: string, id: string, action: string): Promise<string | null> {
    return this.runtime.action(folder, id, action);
  }

  isRunning(folder: string, id: string): boolean {
    return this.runtime.isRunning(folder, id);
  }

  /** Newer versions from the feed, installed and restarted wherever they run. */
  async update(): Promise<string[]> {
    if (!this.d.autoUpdate()) return [];
    const newer = await this.store.updatesFrom(await this.feed(true));
    for (const p of newer) {
      await this.store.install(p, this.d.feed);
      const now = (await this.store.load())[p.id];
      for (const folder of this.d.openFolders())
        if (now && this.runtime.isRunning(folder, p.id)) await this.start(folder, now);
    }
    return newer.map((p) => `${p.name} ${p.version}`);
  }

  /** Every installed plugin's places to open a folder from, as one list. */
  async openFromList(): Promise<{ plugin: string; label: string; items: OpenFromItem[] }[]> {
    const run = runWith(this.d.path);
    const out = [];
    for (const p of Object.values(await this.installed())) {
      if (!p.openFrom) continue;
      const file = this.store.fileOf(p.id);
      const mod = file ? await loadModule(file) : null;
      if (!mod?.openFrom) continue;
      out.push({ plugin: p.id, label: p.openFrom.label, items: await mod.openFrom.list(run) });
    }
    return out;
  }

  /** Opens one into a new folder under ~/Anur; resolves with the folder, or an error. */
  async openFrom(
    plugin: string,
    id: string,
    base = path.join(homedir(), "Anur"),
  ): Promise<{ folder: string } | { error: string }> {
    const file = this.store.fileOf(plugin);
    const mod = file ? await loadModule(file) : null;
    if (!mod?.openFrom) return { error: "That plugin can't open folders." };
    const name = id.split("/").pop() ?? id;
    const { existsSync } = await import("node:fs");
    let dest = path.join(base, name);
    for (let n = 2; existsSync(dest); n++) dest = path.join(base, `${name}-${String(n)}`);
    const run: PluginContext["run"] = runWith(this.d.path);
    const failed = await mod.openFrom.open(run, id, dest);
    return failed ? { error: failed } : { folder: dest };
  }

  async quitAll(ms: number): Promise<void> {
    await this.runtime.quitAll(ms);
  }
}
