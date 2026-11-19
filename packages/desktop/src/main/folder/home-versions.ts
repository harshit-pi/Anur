import path from "node:path";
import { ANUR_DIR, type DocId } from "@anur/core";
import { findHomes, homeIdOf, homeOf } from "./homes.ts";
import { SectionVersions, type LastSaved } from "./versions.ts";

/**
 * Section IDs and history kept in each doc's home (18.15.2), through one
 * router on the opened folder. Callers pass paths from the opened folder, as
 * before; each home's store keeps its docs by their path from the home, so a
 * repo's IDs and history are the same whether the repo or the workspace
 * holding it is opened. A home's new doc IDs carry its own ID, so two repos'
 * README.md never share one.
 */
export class HomeVersions {
  private readonly stores = new Map<string, SectionVersions>();
  /** Where each doc lives, as `locate` found it: what threads and previews follow. */
  private readonly docHome = new Map<DocId, string>();
  private homes: readonly string[] = [];
  private ready: Promise<void>;

  constructor(
    private readonly folder: string,
    private readonly device: string,
    private readonly opts: {
      onError?: (e: unknown) => void;
      /** The text Anur last saved of each doc, per home (2.23). */
      memoryFor?: (home: string) => LastSaved | null;
      sessionMs?: number;
      recording?: () => boolean;
      /** Homes beneath the folder; found on disk unless given, as in tests. */
      findHomes?: (folder: string) => Promise<string[]>;
    } = {},
  ) {
    this.ready = this.refresh();
  }

  /** Look for homes again, as when a repo is cloned into the folder. */
  refresh(): Promise<void> {
    this.ready = (this.opts.findHomes ?? findHomes)(this.folder).then(
      (h) => {
        this.homes = h;
      },
      () => undefined,
    );
    return this.ready;
  }

  /** Every home's `.anur/`, the opened folder's first, once the homes are found. */
  async anurDirs(): Promise<string[]> {
    await this.ready;
    return ["", ...this.homes].map((h) => path.join(this.folder, h, ANUR_DIR));
  }

  /** The home a doc's threads, previews and layout live in, as `locate` found it. */
  anurDirOf(doc: DocId): string {
    return path.join(this.folder, this.docHome.get(doc) ?? "", ANUR_DIR);
  }

  /**
   * A doc's path from the opened folder, from its ID: what a thread that
   * isn't open needs to find its doc. Looked up in the home the doc was
   * located in, else in each home.
   */
  async relOf(doc: DocId): Promise<string | null> {
    await this.ready;
    const known = this.docHome.get(doc);
    const homes = known !== undefined ? [known] : ["", ...this.homes];
    for (const home of homes) {
      const p = await this.store(home).pathOf(doc);
      if (p) return home ? `${home}/${p}` : p;
    }
    return null;
  }

  /** A doc's home, from the opened folder ("" for the folder itself). */
  homeOfDoc(rel: string): string {
    return homeOf(rel, this.homes).home;
  }

  private store(home: string): SectionVersions {
    let s = this.stores.get(home);
    if (!s) {
      const abs = path.join(this.folder, home);
      s = new SectionVersions(
        abs,
        this.device,
        this.opts.onError,
        this.opts.memoryFor?.(abs) ?? null,
        this.opts.sessionMs,
        this.opts.recording,
        () => homeIdOf(abs),
      );
      this.stores.set(home, s);
    }
    return s;
  }

  private async at(rel: string) {
    await this.ready;
    const { home, inHome } = homeOf(rel, this.homes);
    return { home, inHome, store: this.store(home) };
  }

  async opened(rel: string, text: string): Promise<void> {
    const { inHome, store } = await this.at(rel);
    return store.opened(inHome, text);
  }
  async saved(rel: string, text: string): Promise<void> {
    const { inHome, store } = await this.at(rel);
    return store.saved(inHome, text);
  }
  async endSession(rel: string): Promise<void> {
    const { inHome, store } = await this.at(rel);
    return store.endSession(inHome);
  }
  async wroteClosed(rel: string, text: string): Promise<void> {
    const { inHome, store } = await this.at(rel);
    return store.wroteClosed(inHome, text);
  }
  async outside(rel: string, text: string): Promise<void> {
    const { inHome, store } = await this.at(rel);
    return store.outside(inHome, text);
  }
  async restored(
    rel: string,
    text: string,
    sectionPath: readonly string[],
    from: string,
  ): Promise<void> {
    const { inHome, store } = await this.at(rel);
    return store.restored(inHome, text, sectionPath, from);
  }
  async applied(
    rel: string,
    ...rest: Parameters<SectionVersions["applied"]> extends [string, ...infer R] ? R : never
  ): Promise<void> {
    const { inHome, store } = await this.at(rel);
    return store.applied(inHome, ...rest);
  }
  async locate(rel: string, text: string): ReturnType<SectionVersions["locate"]> {
    const { home, inHome, store } = await this.at(rel);
    const found = await store.locate(inHome, text);
    if (found) this.docHome.set(found.doc, home);
    return found;
  }
  async list(
    rel: string,
    text: string,
    sectionPath: readonly string[],
  ): ReturnType<SectionVersions["list"]> {
    const { inHome, store } = await this.at(rel);
    return store.list(inHome, text, sectionPath);
  }
  async orphansOf(rel: string): ReturnType<SectionVersions["orphansOf"]> {
    const { inHome, store } = await this.at(rel);
    return store.orphansOf(inHome);
  }
  async forget(rel: string, orphan: Parameters<SectionVersions["forget"]>[1]): Promise<void> {
    const { inHome, store } = await this.at(rel);
    return store.forget(inHome, orphan);
  }
  async reattach(
    rel: string,
    orphan: Parameters<SectionVersions["reattach"]>[1],
    onto: Parameters<SectionVersions["reattach"]>[2],
  ): Promise<void> {
    const { inHome, store } = await this.at(rel);
    return store.reattach(inHome, orphan, onto);
  }

  /**
   * Docs Anur renamed or moved. Within one home a doc keeps its ID, so its
   * threads and history follow it; moved to another home, it starts afresh
   * there, as a doc copied into another repo does.
   */
  async moved(pairs: readonly { from: string; to: string }[]): Promise<void> {
    await this.ready;
    const byHome = new Map<string, { from: string; to: string }[]>();
    for (const { from, to } of pairs) {
      const a = homeOf(from, this.homes);
      const b = homeOf(to, this.homes);
      if (a.home !== b.home) {
        await this.store(a.home).endSession(a.inHome);
        continue;
      }
      const list = byHome.get(a.home) ?? [];
      list.push({ from: a.inHome, to: b.inHome });
      byHome.set(a.home, list);
    }
    for (const [home, list] of byHome) await this.store(home).moved(list);
  }

  async endAll(): Promise<void> {
    await Promise.all([...this.stores.values()].map((s) => s.endAll()));
  }
}
