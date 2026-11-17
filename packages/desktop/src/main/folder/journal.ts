import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../../vault/anur-folder.ts";

/**
 * Typing kept from a clash (task 2.18). When a change made outside Anur
 * overlaps typing not yet saved, the file's version wins and the person's
 * version of those lines is kept here, in app support, one file per folder,
 * until they put it back or dismiss it. It is never written into the vault.
 * Until previews exist (3.10), this is where overlapping typing goes.
 */

export type KeptEntry = {
  id: string;
  /** The doc, relative to the folder. */
  path: string;
  /** The lines as the person had them, and as the file has them now. */
  mine: string;
  theirs: string;
  /** The lines around them, to find the place again. */
  before: string;
  after: string;
  /** When it was kept, as an ISO time. */
  at: string;
};

export class Journal {
  constructor(private readonly appSupport: string) {}

  private file(folder: string) {
    const key = createHash("sha256").update(folder).digest("hex").slice(0, 32);
    return path.join(this.appSupport, "journal", `${key}.json`);
  }

  private async read(folder: string): Promise<KeptEntry[]> {
    try {
      const parsed = JSON.parse(await readFile(this.file(folder), "utf8")) as unknown;
      return Array.isArray(parsed) ? (parsed as KeptEntry[]) : [];
    } catch {
      return [];
    }
  }

  private async write(folder: string, entries: KeptEntry[]) {
    await mkdir(path.dirname(this.file(folder)), { recursive: true });
    await writeFileAtomic(this.file(folder), JSON.stringify(entries, null, 1));
  }

  async keep(folder: string, entry: Omit<KeptEntry, "id" | "at">): Promise<KeptEntry> {
    const kept: KeptEntry = { ...entry, id: randomUUID(), at: new Date().toISOString() };
    await this.write(folder, [...(await this.read(folder)), kept]);
    return kept;
  }

  async list(folder: string, doc: string): Promise<KeptEntry[]> {
    return (await this.read(folder)).filter((e) => e.path === doc);
  }

  async drop(folder: string, id: string): Promise<void> {
    const entries = await this.read(folder);
    const rest = entries.filter((e) => e.id !== id);
    if (rest.length !== entries.length) await this.write(folder, rest);
  }
}
