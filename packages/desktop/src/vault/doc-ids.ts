import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  DocIdLine,
  LineEnvelope,
  anurPaths,
  buildDocRegistry,
  docIdFor,
  mergeLines,
  normalizeDocPath,
  type DocId,
  type DocRegistry,
} from "@anur/core";
import { z } from "zod";
import { JsonlWriter, readJsonlFile } from "./jsonl-writer.ts";

/** Any ID-log line; doc events are picked out, section events are left for task 1.12. */
const AnyIdLogLine = LineEnvelope.extend({ kind: z.string() }).loose();

/**
 * The folder's doc IDs, rebuilt from every device's ID logs in `.anur/docs/`.
 * New docs and moves are written to this device's log for that doc.
 */
export class DocIds {
  private registry: DocRegistry = { byPath: new Map(), byId: new Map() };

  constructor(
    private readonly anurDir: string,
    private readonly device: string,
  ) {}

  /** Read every doc's ID logs. */
  async load(): Promise<void> {
    const docsDir = path.join(this.anurDir, "docs");
    let docs: string[];
    try {
      docs = await readdir(docsDir);
    } catch {
      docs = [];
    }
    const files: DocIdLine[][] = [];
    for (const doc of docs) {
      const idsDir = path.join(docsDir, doc, "ids");
      let names: string[];
      try {
        names = (await readdir(idsDir)).filter((n) => n.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const n of names) {
        const { lines } = await readJsonlFile(path.join(idsDir, n), AnyIdLogLine);
        files.push(
          lines.flatMap((l) => {
            const parsed = DocIdLine.safeParse(l);
            return parsed.success ? [parsed.data] : [];
          }),
        );
      }
    }
    this.registry = buildDocRegistry(mergeLines(...files));
  }

  private async write(doc: DocId, line: Record<string, unknown>): Promise<void> {
    const w = await JsonlWriter.open(
      path.join(this.anurDir, anurPaths.ids(doc, this.device)),
      this.device,
    );
    try {
      await w.append(line);
    } finally {
      await w.close();
    }
  }

  /** The doc at this path, minting and recording its ID the first time it is seen. */
  async idFor(relPath: string): Promise<DocId> {
    const { doc, isNew } = docIdFor(this.registry, relPath);
    if (isNew) {
      const p = normalizeDocPath(relPath);
      await this.write(doc, { kind: "doc-mint", doc, path: p });
      this.registry.byId.set(doc, { path: p, orphaned: false });
      this.registry.byPath.set(p, doc);
    }
    return doc;
  }

  /** Follow a rename or move made in Anur, so the doc keeps its ID and its threads. */
  async move(doc: DocId, from: string, to: string): Promise<void> {
    const [f, t] = [normalizeDocPath(from), normalizeDocPath(to)];
    await this.write(doc, { kind: "doc-move", doc, from: f, to: t });
    if (this.registry.byPath.get(f) === doc) this.registry.byPath.delete(f);
    this.registry.byPath.set(t, doc);
    this.registry.byId.set(doc, { path: t, orphaned: false });
  }

  /** A doc whose file is gone: kept, with everything behind it, until a person deletes or reattaches it. */
  async orphan(doc: DocId): Promise<void> {
    const entry = this.registry.byId.get(doc);
    if (!entry) throw new Error(`unknown doc ${doc}`);
    await this.write(doc, { kind: "doc-orphaned", doc, path: entry.path });
    if (this.registry.byPath.get(entry.path) === doc) this.registry.byPath.delete(entry.path);
    this.registry.byId.set(doc, { path: entry.path, orphaned: true });
  }

  /** The live doc at this path, if Anur has seen it. */
  lookup(relPath: string): DocId | null {
    return this.registry.byPath.get(normalizeDocPath(relPath)) ?? null;
  }

  pathOf(doc: DocId): string | null {
    return this.registry.byId.get(doc)?.path ?? null;
  }
}
