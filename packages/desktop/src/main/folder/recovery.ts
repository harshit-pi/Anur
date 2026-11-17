import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../../vault/anur-folder.ts";

/**
 * The crash journal (task 2.20). While a page has typing that isn't saved,
 * it writes the text here every two seconds, with the text it last saved;
 * a save clears it. After a crash, the page that opens the doc next finds
 * it and folds the typing back in. It lives in app support, one file per
 * doc, never in the person's folder.
 */

export type Recovered = {
  /** The page's text when it was last journaled. */
  text: string;
  /** What the page had last read or saved, to merge against the file now. */
  saved: string;
  /** When, as an ISO time. */
  at: string;
};

const key = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

export class RecoveryStore {
  constructor(private readonly appSupport: string) {}

  private file(folder: string, doc: string) {
    return path.join(this.appSupport, "recovery", key(folder), `${key(doc)}.json`);
  }

  async write(folder: string, doc: string, entry: Omit<Recovered, "at">): Promise<void> {
    const file = this.file(folder, doc);
    await mkdir(path.dirname(file), { recursive: true });
    const record = { path: doc, ...entry, at: new Date().toISOString() };
    await writeFileAtomic(file, JSON.stringify(record));
  }

  async read(folder: string, doc: string): Promise<Recovered | null> {
    try {
      const r = JSON.parse(await readFile(this.file(folder, doc), "utf8")) as Partial<
        Recovered & { path: string }
      >;
      if (r.path !== doc || typeof r.text !== "string" || typeof r.saved !== "string") return null;
      return { text: r.text, saved: r.saved, at: typeof r.at === "string" ? r.at : "" };
    } catch {
      return null;
    }
  }

  async clear(folder: string, doc: string): Promise<void> {
    await rm(this.file(folder, doc), { force: true });
  }
}
