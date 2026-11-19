import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { ANUR_DIR, MapLayoutFile, anurPaths, type DocId } from "@anur/core";
import { writeFileAtomic } from "../../vault/anur-folder.ts";
import { readFile } from "../../vault/anur-copy.ts";

/**
 * Where a person put boxes on a doc's map (task 7), in
 * `.anur/docs/<doc>/layout/<device>.json`, by section ID. Each device writes
 * its own file; reading takes each section's position from the newest file
 * that has one, so a box moved on another machine shows here too.
 */

type Position = { x: number; y: number };

export class MapLayouts {
  constructor(
    private readonly folder: string,
    private readonly device: string,
  ) {}

  private dir(doc: DocId) {
    return path.join(this.folder, ANUR_DIR, anurPaths.doc(doc), "layout");
  }

  async read(doc: DocId): Promise<Record<string, Position>> {
    let names: string[];
    try {
      names = (await readdir(this.dir(doc))).filter((n) => n.endsWith(".json"));
    } catch {
      return {};
    }
    const files = (
      await Promise.all(
        names.map(async (n) => {
          try {
            const parsed = MapLayoutFile.safeParse(
              JSON.parse(await readFile(path.join(this.dir(doc), n), "utf8")),
            );
            return parsed.success ? parsed.data : null;
          } catch {
            return null;
          }
        }),
      )
    ).filter((f): f is MapLayoutFile => f !== null);
    files.sort((a, b) => a.at.localeCompare(b.at));
    return Object.assign({}, ...files.map((f) => f.positions)) as Record<string, Position>;
  }

  /** This device's positions are now `positions`; null for a section puts its box back in the layout. */
  async write(doc: DocId, positions: Record<string, Position | null>): Promise<void> {
    const file = path.join(this.folder, ANUR_DIR, anurPaths.layout(doc, this.device));
    let mine: Record<string, Position> = {};
    try {
      const parsed = MapLayoutFile.safeParse(JSON.parse(await readFile(file, "utf8")));
      if (parsed.success) mine = parsed.data.positions;
    } catch {
      // No file yet.
    }
    for (const [id, p] of Object.entries(positions)) {
      if (p === null) Reflect.deleteProperty(mine, id);
      else mine[id] = { x: Math.round(p.x), y: Math.round(p.y) };
    }
    const out = MapLayoutFile.parse({
      at: new Date().toISOString(),
      dev: this.device,
      positions: mine,
    });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, `${JSON.stringify(out, null, 1)}\n`);
  }
}
