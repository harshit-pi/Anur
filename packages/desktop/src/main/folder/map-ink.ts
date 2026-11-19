import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ANUR_DIR, anurPaths, type DocId } from "@anur/core";
import { writeFileAtomic } from "../../vault/anur-folder.ts";

/**
 * Pen strokes drawn on a doc's map, in `.anur/docs/<doc>/ink/<device>.json`.
 * Each device writes its own file, so two Macs never fight over one; erasing
 * someone else's stroke is kept as an erased ID in your own file. A stroke
 * is anchored to the box it was drawn nearest, so it moves with that box.
 */

export const InkStroke = z.object({
  id: z.string().max(64),
  /** The box it belongs to (a section or thread ID), or null: placed on the map itself. */
  anchor: z.string().max(200).nullable(),
  /** Points, relative to the anchor box's centre (or the map's origin). */
  pts: z.array(z.tuple([z.number(), z.number()])).max(5000),
  color: z.string().max(32),
});
export type InkStroke = z.infer<typeof InkStroke>;

const InkFile = z.object({
  strokes: z.array(InkStroke).max(2000),
  erased: z.array(z.string().max(64)).max(10000),
});
type InkFile = z.infer<typeof InkFile>;

export class MapInk {
  constructor(
    private readonly folder: string,
    private readonly device: string,
  ) {}

  private dir(doc: DocId) {
    return path.join(this.folder, ANUR_DIR, anurPaths.doc(doc), "ink");
  }

  private async file(p: string): Promise<InkFile> {
    try {
      const parsed = InkFile.safeParse(JSON.parse(await readFile(p, "utf8")));
      return parsed.success ? parsed.data : { strokes: [], erased: [] };
    } catch {
      return { strokes: [], erased: [] };
    }
  }

  /** Every device's strokes, less any a device erased. */
  async read(doc: DocId): Promise<InkStroke[]> {
    let names: string[];
    try {
      names = (await readdir(this.dir(doc))).filter((n) => n.endsWith(".json"));
    } catch {
      return [];
    }
    const files = await Promise.all(names.map((n) => this.file(path.join(this.dir(doc), n))));
    const erased = new Set(files.flatMap((f) => f.erased));
    return files.flatMap((f) => f.strokes).filter((s) => !erased.has(s.id));
  }

  /** New strokes from this device, and strokes (anyone's) erased here. */
  async change(doc: DocId, add: InkStroke[], erase: string[]): Promise<void> {
    const p = path.join(this.dir(doc), `${this.device}.json`);
    const mine = await this.file(p);
    const gone = new Set(erase);
    const next: InkFile = {
      strokes: [...mine.strokes.filter((s) => !gone.has(s.id)), ...add].slice(-2000),
      erased: [...new Set([...mine.erased, ...erase])].slice(-10000),
    };
    await mkdir(this.dir(doc), { recursive: true });
    await writeFileAtomic(p, JSON.stringify(next));
  }
}
