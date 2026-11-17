import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  ANUR_DIR,
  VersionLine,
  anurPaths,
  buildSectionTree,
  hasConflictMarkers,
  matchSections,
  mergeLines,
  sectionBodies,
  type DocId,
  type SectionId,
  type SectionTree,
} from "@anur/core";
import { writeFileAtomic } from "../../vault/anur-folder.ts";
import { DocIds } from "../../vault/doc-ids.ts";
import { JsonlWriter, readJsonlFile } from "../../vault/jsonl-writer.ts";
import { SectionIds } from "../../vault/section-ids.ts";

/**
 * Section versions (task 2.21). The first time a doc is opened, each of its
 * sections gets a starting version in `.anur/docs/<doc>/history/`, so a
 * later edit made elsewhere never loses the earlier text. When the file
 * changes outside Anur, each section whose text changed gets a version of
 * its new text, after one of the text it replaced if History didn't have
 * that yet. Section IDs follow the headings through saves and outside
 * changes by the matcher; while the file holds merge-conflict markers,
 * nothing is matched or recorded (2.19).
 */

type Known = { text: string; tree: SectionTree; ids: SectionId[] };

/** Where the text Anur last saved of each doc is kept. */
export type LastSaved = {
  read(rel: string): Promise<string | null>;
  write(rel: string, text: string): Promise<void>;
};

/** The last saved texts of one folder's docs, in app support: never in the folder. */
export function lastSavedIn(appSupport: string, folder: string): LastSaved {
  const key = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
  const file = (rel: string) => path.join(appSupport, "last-saved", key(folder), `${key(rel)}.md`);
  return {
    async read(rel) {
      return readFile(file(rel), "utf8").catch(() => null);
    },
    async write(rel, text) {
      await mkdir(path.dirname(file(rel)), { recursive: true });
      await writeFileAtomic(file(rel), text);
    },
  };
}

export class SectionVersions {
  private readonly anurDir: string;
  private readonly docIds: DocIds;
  private readonly sectionIds: SectionIds;
  private loaded: Promise<void> | null = null;
  /** Each open doc's text as Anur last knew it, with its sections' IDs. */
  private readonly known = new Map<string, Known>();
  /** One change at a time, so the ID logs and history are written in order. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Each doc's open typing session: the text it started from, and its idle timer. */
  private readonly sessions = new Map<
    string,
    { from: Known; timer: ReturnType<typeof setTimeout> | null }
  >();

  constructor(
    folder: string,
    private readonly device: string,
    private readonly onError: (e: unknown) => void = () => undefined,
    /** The text Anur last saved of each doc, kept on this install (2.23). */
    private readonly memory: LastSaved | null = null,
    private readonly sessionMs = 120_000,
  ) {
    this.anurDir = path.join(folder, ANUR_DIR);
    this.docIds = new DocIds(this.anurDir, device);
    this.sectionIds = new SectionIds(this.anurDir, device);
  }

  /**
   * The doc was opened with `text`. Sections that differ from the text Anur
   * last saved changed while it was closed, as by a pull: those are outside
   * versions (2.23). Then each section with no history gets its starting version.
   */
  opened(rel: string, text: string): Promise<void> {
    return this.run(async () => {
      const last = await this.memory?.read(rel);
      let before: Known | null = null;
      if (last && last !== text) before = (await this.assign(rel, last, null)).now;
      const { doc, now } = await this.assign(rel, text, before);
      if (!now) return;
      if (before)
        await this.record(doc, before, now, "outside", "Changed while the doc was closed");
      for (const [i, id] of now.ids.entries()) {
        if (!(await this.hasHistory(doc, id))) {
          await this.write(doc, id, now, i, "start", "The text when Anur first opened the doc");
        }
      }
      await this.memory?.write(rel, text);
    });
  }

  /**
   * Anur saved `text`: follow renamed and moved headings, and keep the
   * typing session open. A session ends after two minutes without a save,
   * when the doc closes, or when an outside change arrives (2.24).
   */
  saved(rel: string, text: string): Promise<void> {
    return this.run(async () => {
      const before = this.known.get(rel) ?? null;
      if (before && !this.sessions.has(rel)) this.sessions.set(rel, { from: before, timer: null });
      await this.assign(rel, text, before);
      await this.memory?.write(rel, text);
      const session = this.sessions.get(rel);
      if (session) {
        if (session.timer) clearTimeout(session.timer);
        session.timer = setTimeout(() => {
          void this.endSession(rel);
        }, this.sessionMs);
      }
    });
  }

  /** The typing session on `rel` is over: a typing version of each section it changed. */
  endSession(rel: string): Promise<void> {
    return this.run(async () => {
      await this.closeSession(rel);
    });
  }

  /** Every open session, as at quit. */
  endAll(): Promise<void> {
    return this.run(async () => {
      for (const rel of [...this.sessions.keys()]) await this.closeSession(rel);
    });
  }

  /** The file changed outside Anur to `text`: a version for each section that changed. */
  outside(rel: string, text: string): Promise<void> {
    return this.run(async () => {
      await this.closeSession(rel);
      const before = this.known.get(rel) ?? null;
      const { doc, now } = await this.assign(rel, text, before);
      if (!now) return;
      await this.record(doc, before, now, "outside", "Changed outside Anur");
      await this.memory?.write(rel, text);
    });
  }

  private async closeSession(rel: string): Promise<void> {
    const session = this.sessions.get(rel);
    if (!session) return;
    this.sessions.delete(rel);
    if (session.timer) clearTimeout(session.timer);
    const now = this.known.get(rel);
    if (!now || now === session.from) return;
    this.loaded ??= this.docIds.load();
    await this.loaded;
    const doc = await this.docIds.idFor(rel);
    await this.record(doc, session.from, now, "typing", "Typed in Anur");
  }

  /**
   * A version of each section whose own text changed from `before` to
   * `now`. For an outside change, the text it replaced goes in first if
   * History doesn't have it yet.
   */
  private async record(
    doc: DocId,
    before: Known | null,
    now: Known,
    cause: "outside" | "typing",
    summary: string,
  ): Promise<void> {
    for (const [i, id] of now.ids.entries()) {
      const was = before ? before.ids.indexOf(id) : -1;
      const old = before && was >= 0 ? ownText(before, was) : null;
      if (old !== null && old === ownText(now, i)) continue;
      if (cause === "outside" && before && was >= 0) {
        const replaced = subtreeOf(before, was);
        if ((await this.latest(doc, id)) !== replaced) {
          await this.write(doc, id, before, was, "typing", "Before the change made outside Anur");
        }
      }
      await this.write(doc, id, now, i, cause, summary);
    }
  }

  private run(fn: () => Promise<void>): Promise<void> {
    const next = this.queue.then(fn).catch(this.onError);
    this.queue = next;
    return next;
  }

  /** IDs for the doc's sections, carried from what Anur knew where it can. */
  private async assign(
    rel: string,
    text: string,
    before: Known | null,
  ): Promise<{ doc: DocId; now: Known | null }> {
    this.loaded ??= this.docIds.load();
    await this.loaded;
    const doc = await this.docIds.idFor(rel);
    // A conflicted file's headings could take the wrong IDs: wait until it's resolved.
    if (hasConflictMarkers(text)) return { doc, now: null };
    const tree = buildSectionTree(text, { fileName: path.basename(rel) });
    const bodies = sectionBodies(text, tree);
    const carried = before
      ? matchSections(
          before.tree.sections.map((s, i) => ({
            id: before.ids[i] as SectionId,
            path: s.path,
            body: sectionBodies(before.text, before.tree)[i] ?? "",
          })),
          tree.sections.map((s, i) => ({ path: s.path, body: bodies[i] ?? "" })),
        ).carried
      : tree.sections.map(() => null);
    const ids = await this.sectionIds.save(
      doc,
      tree.sections.map((s, i) => ({
        path: s.path,
        ordinal: s.ordinal,
        carried: carried[i] ?? null,
      })),
    );
    const now = { text, tree, ids };
    this.known.set(rel, now);
    return { doc, now };
  }

  private historyDir(doc: DocId, id: SectionId) {
    return path.join(this.anurDir, path.dirname(anurPaths.history(doc, id, this.device)));
  }

  private async hasHistory(doc: DocId, id: SectionId): Promise<boolean> {
    try {
      return (await readdir(this.historyDir(doc, id))).some((n) => n.endsWith(".jsonl"));
    } catch {
      return false;
    }
  }

  /** The newest version's text across every device, or null. */
  private async latest(doc: DocId, id: SectionId): Promise<string | null> {
    let names: string[];
    try {
      names = (await readdir(this.historyDir(doc, id))).filter((n) => n.endsWith(".jsonl"));
    } catch {
      return null;
    }
    const files = await Promise.all(
      names.map(
        async (n) =>
          (await readJsonlFile(path.join(this.historyDir(doc, id), n), VersionLine)).lines,
      ),
    );
    const all = mergeLines(...files).sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
    return all.at(-1)?.text ?? null;
  }

  private async write(
    doc: DocId,
    id: SectionId,
    from: Known,
    i: number,
    cause: "start" | "typing" | "outside",
    summary: string,
  ): Promise<void> {
    const section = from.tree.sections[i];
    if (!section) return;
    const w = await JsonlWriter.open(
      path.join(this.anurDir, anurPaths.history(doc, id, this.device)),
      this.device,
    );
    try {
      await w.append({
        kind: "version",
        cause,
        text: subtreeOf(from, i),
        path: section.path.length > 0 ? section.path : [path.basename(doc)],
        summary,
        preview: null,
        thread: null,
      });
    } finally {
      await w.close();
    }
  }
}

const subtreeOf = (k: Known, i: number) => {
  const s = k.tree.sections[i];
  return s ? k.text.slice(s.subtreeRange.from, s.subtreeRange.to) : "";
};
const ownText = (k: Known, i: number) => {
  const s = k.tree.sections[i];
  return s ? k.text.slice(s.ownRange.from, s.ownRange.to) : "";
};
