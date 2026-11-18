import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  buildSectionTree,
  resolveHeading,
  resolveWiki,
  type SectionNode,
  type SectionTree,
} from "@anur/core";
import { listDocs } from "./list-docs.ts";

/**
 * The folder's links (group 8; Architecture, "Index"): every doc parsed for
 * the wiki links in its sections, kept by modified time so a doc is parsed
 * again only when it changes. It answers where a section's links go, and
 * which sections link to it, across the folder.
 *
 * Closed docs are read from disk; the open doc's text comes from its page,
 * passed in, so links being typed count at once. Docs still in iCloud are
 * never read: reading one would download it.
 */

/** A link written in a section, as the index keeps it. */
export type IndexedLink = {
  /** The doc and section it is written in. */
  from: { doc: string; path: string[] };
  /** The doc it points to, or null when no doc by that name exists. */
  doc: string | null;
  /** The heading it names, as written; null for the whole doc. */
  heading: string | null;
  /** As written, for a broken one: "Spec" or "Spec#Plans". */
  written: string;
  embed: boolean;
};

type Entry = { mtime: number; size: number; links: IndexedLink[]; sections: SectionNode[] };

/** How long a scan of the folder's file times is trusted before the next. */
const FRESH_MS = 2000;

export class LinkIndex {
  private readonly entries = new Map<string, Entry>();
  private docs: string[] = [];
  private scanned = 0;
  private scanning: Promise<void> | null = null;

  constructor(
    private readonly folder: string,
    /** Docs still in iCloud, never read. */
    private readonly offloaded: () => ReadonlySet<string> = () => new Set(),
  ) {}

  /** Every doc's links, parsed again where the file changed since. */
  private async scan(): Promise<void> {
    if (Date.now() - this.scanned < FRESH_MS) return;
    this.scanning ??= (async () => {
      const { docs } = await listDocs(this.folder);
      this.docs = docs;
      const skip = this.offloaded();
      const live = new Set(docs);
      for (const rel of this.entries.keys()) if (!live.has(rel)) this.entries.delete(rel);
      for (let i = 0; i < docs.length; i += 64)
        await Promise.all(
          docs.slice(i, i + 64).map(async (rel) => {
            if (skip.has(rel)) return;
            const s = await stat(path.join(this.folder, rel)).catch(() => null);
            if (!s) return;
            const had = this.entries.get(rel);
            if (had && had.mtime === s.mtimeMs && had.size === s.size) return;
            const text = await readFile(path.join(this.folder, rel), "utf8").catch(() => null);
            if (text === null) return;
            this.entries.set(rel, { mtime: s.mtimeMs, size: s.size, ...this.parse(rel, text) });
          }),
        );
      this.scanned = Date.now();
    })().finally(() => {
      this.scanning = null;
    });
    await this.scanning;
  }

  private parse(rel: string, text: string): Pick<Entry, "links" | "sections"> {
    const tree = buildSectionTree(text, { fileName: path.basename(rel) });
    return { links: this.linksOf(rel, tree), sections: tree.sections };
  }

  /** The links written in each section of `tree`, resolved against the folder's docs. */
  private linksOf(rel: string, tree: SectionTree): IndexedLink[] {
    return tree.sections.flatMap((s) =>
      s.linksOut.map((l) => {
        const to = resolveWiki(this.docs, rel, l.target, l.heading);
        return {
          from: { doc: rel, path: s.path },
          doc: to.kind === "doc" ? to.path : null,
          heading: l.heading,
          written: `${l.target}${l.heading ? `#${l.heading}` : ""}`,
          embed: l.embed,
        };
      }),
    );
  }

  /** The folder's docs, as last listed. */
  async allDocs(): Promise<string[]> {
    await this.scan();
    return this.docs;
  }

  /**
   * The links written in one section's own text, in reading order; not its
   * subsections', which have their own threads, so a doc's title doesn't
   * gather every link in the doc, "Related" lists included. `text` is the
   * open doc's text, when it is open.
   */
  async linksOut(
    rel: string,
    sectionPath: readonly string[],
    text?: string,
  ): Promise<IndexedLink[]> {
    await this.scan();
    const links =
      text !== undefined
        ? this.linksOf(rel, buildSectionTree(text, { fileName: path.basename(rel) }))
        : (this.entries.get(rel)?.links ?? []);
    const want = sectionPath.join("\u0000");
    return links.filter((l) => l.from.path.join("\u0000") === want);
  }

  /**
   * The sections elsewhere that link to this section, or to its doc as a
   * whole.
   */
  async linksIn(rel: string, sectionPath: readonly string[]): Promise<IndexedLink[]> {
    await this.scan();
    const sections = this.entries.get(rel)?.sections ?? [];
    const wanted = sectionPath.join("\u0000");
    const isTitle = sectionPath.length <= 1;
    const out: IndexedLink[] = [];
    const seen = new Set<string>();
    for (const e of this.entries.values())
      for (const l of e.links) {
        // Each linking section once, however many times it links here.
        const from = `${l.from.doc}\u0000${l.from.path.join("\u0000")}`;
        if (seen.has(from)) continue;
        if (l.doc !== rel || (l.from.doc === rel && startsWith(l.from.path, sectionPath))) continue;
        if (l.heading === null) {
          if (isTitle) {
            seen.add(from);
            out.push(l);
          }
          continue;
        }
        const at = resolveHeading(sections, l.heading);
        if (at !== null && sections[at]?.path.join("\u0000") === wanted) {
          seen.add(from);
          out.push(l);
        }
      }
    return out;
  }
}

const startsWith = (path: readonly string[], prefix: readonly string[]) =>
  prefix.every((p, i) => path[i] === p);
