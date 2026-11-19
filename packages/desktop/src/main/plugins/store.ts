import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Feed, FeedPlugin, RUNTIME_API, newer } from "@anur/core";
import { writeFileAtomic } from "../../vault/anur-folder.ts";

/**
 * Standard plugins from Anur's feed (Plugins and Git mock). The feed is one
 * signed index beside the plugins' files; a plugin installs only when the
 * index's signature is Anur's and its file's hash is the one the index names,
 * so nothing anyone else wrote ever runs. Installed ones live in app support
 * and update themselves unless the person turns that off.
 */

/** Anur's plugin signing key (Ed25519, public half); the private half signs each feed. */
export const PLUGIN_KEY = "MCowBQYDK2VwAyEAFyfpiI5b0M2rXlaRc7vg4E0N/f7gtCeMhKWYCbUh+S0=";

/** Where the feed lives; ANUR_PLUGIN_FEED points elsewhere, as a folder for a test. */
export const FEED = process.env.ANUR_PLUGIN_FEED ?? "https://do7t8q39ulre5.cloudfront.net/plugins/";

const join = (base: string, name: string) => (base.endsWith("/") ? base : `${base}/`) + name;

async function fetchBytes(url: string): Promise<Buffer> {
  if (url.startsWith("file:")) return readFile(fileURLToPath(url));
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`The plugin feed answered ${String(r.status)}.`);
  return Buffer.from(await r.arrayBuffer());
}

/** Whether `sig` (base64) is Anur's signature over `data`. */
export function signedByAnur(data: Buffer, sig: string, key = PLUGIN_KEY): boolean {
  try {
    const pub = createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
    return verify(null, data, pub, Buffer.from(sig.trim(), "base64"));
  } catch {
    return false;
  }
}

/** The feed's plugins, only when its index is signed by Anur; ones this Anur can't run are left out. */
export async function readFeed(base = FEED, key = PLUGIN_KEY): Promise<FeedPlugin[]> {
  const [index, sig] = await Promise.all([
    fetchBytes(join(base, "index.json")),
    fetchBytes(join(base, "index.json.sig")),
  ]);
  if (!signedByAnur(index, sig.toString("utf8"), key))
    throw new Error("The plugin feed isn't signed by Anur, so nothing from it was installed.");
  const feed = Feed.parse(JSON.parse(index.toString("utf8")));
  return feed.plugins.filter((p) => p.apiVersion <= RUNTIME_API);
}

export type Installed = FeedPlugin & { installedAt: string };

/** The plugins installed on this Mac, and their files. */
export class PluginStore {
  private installed: Record<string, Installed> = {};
  private loaded = false;

  constructor(private readonly dir: string) {}

  private get list() {
    return path.join(this.dir, "installed.json");
  }

  async load(): Promise<Record<string, Installed>> {
    if (this.loaded) return this.installed;
    try {
      const raw = JSON.parse(await readFile(this.list, "utf8")) as Record<string, unknown>;
      for (const [id, v] of Object.entries(raw)) {
        const p = FeedPlugin.safeParse(v);
        if (p.success && p.data.id === id)
          this.installed[id] = { ...p.data, installedAt: (v as Installed).installedAt };
      }
    } catch {
      this.installed = {};
    }
    this.loaded = true;
    return this.installed;
  }

  /** The installed plugin's module file. */
  fileOf(id: string): string | null {
    const p = this.installed[id];
    return p ? path.join(this.dir, id, `${p.version}.mjs`) : null;
  }

  /** Downloads `p`, checks its hash against the signed index, and keeps it. */
  async install(p: FeedPlugin, base = FEED): Promise<Installed> {
    await this.load();
    const bytes = await fetchBytes(join(base, p.file));
    const sum = createHash("sha256").update(bytes).digest("hex");
    if (sum !== p.sha256)
      throw new Error(`${p.name} didn't match what Anur signed, so it wasn't installed.`);
    const file = path.join(this.dir, p.id, `${p.version}.mjs`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    const was = this.installed[p.id];
    this.installed[p.id] = { ...p, installedAt: new Date().toISOString() };
    await mkdir(this.dir, { recursive: true });
    await writeFileAtomic(this.list, JSON.stringify(this.installed, null, 1));
    // The version it replaces goes once the new one is in place.
    if (was && was.version !== p.version)
      await rm(path.join(this.dir, p.id, `${was.version}.mjs`), { force: true });
    return this.installed[p.id] as Installed;
  }

  async uninstall(id: string): Promise<void> {
    await this.load();
    this.installed = Object.fromEntries(Object.entries(this.installed).filter(([k]) => k !== id));
    await writeFileAtomic(this.list, JSON.stringify(this.installed, null, 1));
    await rm(path.join(this.dir, id), { recursive: true, force: true });
  }

  /** Installed plugins the feed has a newer version of. */
  async updatesFrom(feed: readonly FeedPlugin[]): Promise<FeedPlugin[]> {
    const have = await this.load();
    return feed.filter((p) => {
      const had = have[p.id];
      return had && newer(p.version, had.version);
    });
  }
}
