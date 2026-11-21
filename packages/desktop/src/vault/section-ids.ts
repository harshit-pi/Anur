import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  LineEnvelope,
  SectionIdLine,
  anurPaths,
  assignSectionIds,
  buildSectionIdState,
  canonicalId,
  mergeLines,
  orphanedIds,
  type DocId,
  type IdRecord,
  type SectionId,
  type SectionIdState,
  type SectionToSave,
} from "@anur/core";
import { z } from "zod";
import { JsonlWriter, readJsonlFile } from "./jsonl-writer.ts";

const AnyIdLogLine = LineEnvelope.extend({ kind: z.string() }).loose();

/**
 * One doc's section IDs on disk: every device's ID log read and merged, and
 * this device's events written to its own file. Doc events in the same log
 * are left to `DocIds`.
 */
export class SectionIds {
  constructor(
    private readonly anurDir: string,
    private readonly device: string,
  ) {}

  async state(doc: DocId): Promise<SectionIdState> {
    const dir = path.join(this.anurDir, path.dirname(anurPaths.ids(doc, this.device)));
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
    } catch {
      names = [];
    }
    const files = await Promise.all(
      names.map(async (n) => {
        const { lines } = await readJsonlFile(path.join(dir, n), AnyIdLogLine);
        return lines.flatMap((l) => {
          const parsed = SectionIdLine.safeParse(l);
          return parsed.success ? [parsed.data] : [];
        });
      }),
    );
    return buildSectionIdState(mergeLines(...files));
  }

  private async write(doc: DocId, events: readonly Record<string, unknown>[]): Promise<void> {
    if (events.length === 0) return;
    const w = await JsonlWriter.open(
      path.join(this.anurDir, anurPaths.ids(doc, this.device)),
      this.device,
    );
    try {
      await w.appendMany(events);
    } finally {
      await w.close();
    }
  }

  /** Assign IDs to a doc's sections at save, writing any mint, rename, alias or orphaned lines. */
  async save(doc: DocId, sections: readonly SectionToSave[]): Promise<SectionId[]> {
    const { ids, events } = assignSectionIds(await this.state(doc), doc, sections);
    await this.write(doc, events);
    return ids;
  }

  /** Move an orphan's threads and history onto the section a person picked. */
  async reattach(doc: DocId, orphan: SectionId, onto: SectionId): Promise<void> {
    const state = await this.state(doc);
    const target = state.get(canonicalId(state, onto));
    if (!state.get(orphan)?.orphaned) throw new Error(`${orphan} is not orphaned`);
    if (!target || target.orphaned) throw new Error(`${onto} is not a live section`);
    await this.write(doc, [
      { kind: "reattach", section: orphan, onto: target.id, path: target.path },
    ]);
  }

  async orphaned(doc: DocId): Promise<IdRecord[]> {
    return orphanedIds(await this.state(doc));
  }
}
