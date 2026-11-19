import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { FeedPlugin, OpenFromItem, PluginContext, PluginStatus } from "@anur/core";
import { writeFileAtomic } from "../../vault/anur-folder.ts";
import { PluginStore, readFeed, type Installed } from "./store.ts";
import { PluginRuntime, loadModule, runWith } from "./runtime.ts";

/**
 * Downloaded plugins in the app (Plugins and Git mock): the marketplace's
 * list, installing one and switching it on at once, each folder's settings,
 * running each plugin for every folder it's on in, and updating them all by
 * themselves unless the person turned that off.
 */

type Value = string | boolean;

export type PluginsDeps = {
  dir: string;
  /** Plugin IDs switched on in a folder, and saving them. */
  onIn: (folder: string) => string[];
  setOn: (folder: string, ids: string[]) => Promise<void>;
  /** Folders open now. */
  openFolders: () => string[];
  person: (folder: string) => Promise<{ name: string; handle: string | null }>;
  path: () => Promise<string>;
  status: (folder: string, plugin: string, s: PluginStatus | null) => void;
  notify: (folder: string, text: string, tone: "info" | "warn") => void;
  filesChanged: (folder: string) => void;
  autoUpdate: () => boolean;
  feed?: string;
};

export const inICloud = (folder: string) =>
  folder.includes(`${path.sep}Library${path.sep}Mobile Documents${path.sep}`);

export class Plugins {
  readonly store: PluginStore;
  private readonly runtime = new PluginRuntime();
  private values: Record<string, Record<string, Record<string, Value>>> = {};
  private loaded = false;
  private feedCache: { at: number; plugins: FeedPlugin[] } | null = null;

  constructor(private readonly d: PluginsDeps) {
    this.store = new PluginStore(d.dir);
  }

  private get settingsFile() {
    return path.join(this.d.dir, "settings.json");
  }

  private async load() {
    if (this.loaded) return;
    await this.store.load();
    try {
      this.values = JSON.parse(await readFile(this.settingsFile, "utf8")) as typeof this.values;
    } catch {
      this.values = {};
    }
    this.loaded = true;
  }

  /** The feed's plugins, read at most once a minute. */
  async feed(fresh = false): Promise<FeedPlugin[]> {
    if (!fresh && this.feedCache && Date.now() - this.feedCache.at < 60_000)
      return this.feedCache.plugins;
    const plugins = await readFeed(this.d.feed);
    this.feedCache = { at: Date.now(), plugins };
    return plugins;
  }

  async installed(): Promise<Record<string, Installed>> {
    await this.load();
    return this.store.load();
  }

  /** A folder's value of a plugin's setting, else its default. */
  value(folder: string, p: FeedPlugin, key: string): Value {
    const set = this.values[folder]?.[p.id]?.[key];
    if (set !== undefined) return set;
    const def = p.settings.find((s) => s.key === key);
    return def ? def.default : false;
  }

  async setValue(folder: string, id: string, key: string, value: Value): Promise<void> {
    await this.load();
    const forFolder = (this.values[folder] ??= {});
    (forFolder[id] ??= {})[key] = value;
    await writeFileAtomic(this.settingsFile, JSON.stringify(this.values, null, 1));
    this.runtime.settingsChanged(folder, id);
  }

  /** Starts every installed plugin switched on for `folder`. */
  async startFolder(folder: string): Promise<void> {
    const have = await this.installed();
    for (const id of this.d.onIn(folder)) {
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
    await this.load();
    const p = (await this.feed(true)).find((x) => x.id === id);
    if (!p) throw new Error(`The feed has no plugin "${id}".`);
    const got = await this.store.install(p, this.d.feed);
    if (folder) await this.setOn(folder, id, true);
    return got;
  }

  async uninstall(id: string): Promise<void> {
    for (const folder of this.d.openFolders()) {
      await this.runtime.stop(folder, id);
      await this.d.setOn(
        folder,
        this.d.onIn(folder).filter((x) => x !== id),
      );
    }
    await this.store.uninstall(id);
  }

  async setOn(folder: string, id: string, on: boolean): Promise<void> {
    const now = this.d.onIn(folder).filter((x) => x !== id);
    if (on) now.push(id);
    await this.d.setOn(folder, now);
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
