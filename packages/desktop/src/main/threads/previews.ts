import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  ANUR_DIR,
  PreviewFile,
  anurPaths,
  currentPreview,
  encodePreviewFile,
  type DocId,
  type PreviewPart,
} from "@anur/core";
import { writeFileAtomic } from "../../vault/anur-folder.ts";
import { readFile } from "../../vault/anur-copy.ts";

/**
 * Previews on disk (task 1.8's format): one file per thread per doc per
 * device, `docs/<doc>/previews/<device>/<preview>.json`. Across devices the
 * newest file wins, and a file holds only what is still undecided, so an
 * applied or rejected part is simply gone from the next one.
 */

/** A thread's preview of a doc is named after the thread: one per thread per doc. */
export const previewIdOf = (thread: string) => `p${thread}`;

export class PreviewStore {
  constructor(
    private readonly folder: string,
    private readonly device: string,
    /** A doc's `.anur/`, in its home (18.15.2); the folder's when not given. */
    private readonly anurOf: (doc: DocId) => string = () => path.join(folder, ANUR_DIR),
  ) {}

  private dir(doc: DocId) {
    return path.join(this.anurOf(doc), anurPaths.doc(doc), "previews");
  }

  /** The thread's current preview of the doc, or null when it has none. */
  async read(doc: DocId, thread: string): Promise<PreviewFile | null> {
    const id = previewIdOf(thread);
    let devices: string[];
    try {
      devices = await readdir(this.dir(doc));
    } catch {
      return null;
    }
    const files = await Promise.all(
      devices.map(async (dev) => {
        try {
          const raw = await readFile(path.join(this.dir(doc), dev, `${id}.json`), "utf8");
          const parsed = PreviewFile.safeParse(JSON.parse(raw));
          return parsed.success ? parsed.data : null;
        } catch {
          return null;
        }
      }),
    );
    return currentPreview(files.filter((f): f is PreviewFile => f !== null));
  }

  /** Every thread's current preview of the doc that still proposes something. */
  async list(doc: DocId): Promise<PreviewFile[]> {
    let devices: string[];
    try {
      devices = await readdir(this.dir(doc));
    } catch {
      return [];
    }
    const ids = new Set<string>();
    for (const dev of devices) {
      try {
        for (const n of await readdir(path.join(this.dir(doc), dev)))
          if (n.endsWith(".json")) ids.add(n.slice(0, -5));
      } catch {
        // Not a folder: skip it.
      }
    }
    const previews = await Promise.all(
      [...ids].filter((id) => id.startsWith("p")).map((id) => this.read(doc, id.slice(1))),
    );
    return previews.filter((p): p is PreviewFile => p !== null && p.parts.length > 0);
  }

  /** The thread's preview of the doc is now `parts`; an empty list says nothing is left. */
  async write(doc: DocId, thread: string, parts: PreviewPart[], summary: string | null = null) {
    const id = previewIdOf(thread);
    const file: PreviewFile = PreviewFile.parse({
      id,
      thread,
      changeSet: thread,
      at: new Date().toISOString(),
      dev: this.device,
      summary,
      kind: "edit",
      doc,
      newDocPath: null,
      parts,
    });
    const target = path.join(this.anurOf(doc), anurPaths.preview(doc, this.device, id));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFileAtomic(target, encodePreviewFile(file));
    return file;
  }
}
