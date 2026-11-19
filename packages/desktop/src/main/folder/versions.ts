import { createHash } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  ANUR_DIR,
  HistoryLine,
  VersionLine,
  anurPaths,
  buildSectionTree,
  canonicalId,
  describeChange,
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
import { readFile } from "../../vault/anur-copy.ts";

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
    /** Whether versions are written; IDs are tracked either way, since threads need them (2.25). */
    private readonly recording: () => boolean = () => true,
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
      await this.settleApplies(doc, now);
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

  /**
   * Docs Anur renamed or moved: each keeps its ID, so its sections, threads
   * and history follow it. A typing session on the old path ends first.
   */
  moved(pairs: readonly { from: string; to: string }[]): Promise<void> {
    return this.run(async () => {
      this.loaded ??= this.docIds.load();
      await this.loaded;
      for (const { from, to } of pairs) {
        await this.closeSession(from);
        const doc = this.docIds.lookup(from);
        if (doc) await this.docIds.move(doc, from, to);
        const known = this.known.get(from);
        if (known) {
          this.known.delete(from);
          this.known.set(to, known);
        }
        const last = await this.memory?.read(from);
        if (last !== null && last !== undefined) await this.memory?.write(to, last);
      }
    });
  }

  /** Anur rewrote a closed doc, as for links: its text is Anur's own, not a change from outside. */
  wroteClosed(rel: string, text: string): Promise<void> {
    return this.run(async () => {
      await this.memory?.write(rel, text);
    });
  }

  /** Every open session, as at quit. */
  endAll(): Promise<void> {
    return this.run(async () => {
      for (const rel of [...this.sessions.keys()]) await this.closeSession(rel);
    });
  }

  /**
   * The IDs of the doc's sections for `text`, carried from what Anur knew,
   * and the tree they belong to: what a thread is pinned to (3.1).
   */
  locate(
    rel: string,
    text: string,
  ): Promise<{
    doc: DocId;
    tree: SectionTree;
    ids: SectionId[];
    canon: ReadonlyMap<SectionId, SectionId>;
  } | null> {
    let found: {
      doc: DocId;
      tree: SectionTree;
      ids: SectionId[];
      canon: ReadonlyMap<SectionId, SectionId>;
    } | null = null;
    return this.run(async () => {
      const known = this.known.get(rel);
      if (known?.text === text) {
        this.loaded ??= this.docIds.load();
        await this.loaded;
        const doc = await this.docIds.idFor(rel);
        found = { doc, tree: known.tree, ids: known.ids, canon: await this.canonOf(doc) };
        return;
      }
      const { doc, now } = await this.assign(rel, text, known ?? null);
      if (now) found = { doc, tree: now.tree, ids: now.ids, canon: await this.canonOf(doc) };
    }).then(() => found);
  }

  /** IDs joined to another by an alias or a Reattach, each to the ID it stands for now (11.1). */
  private async canonOf(doc: DocId): Promise<ReadonlyMap<SectionId, SectionId>> {
    const state = await this.sectionIds.state(doc);
    const out = new Map<SectionId, SectionId>();
    for (const rec of state.values()) if (rec.joinedTo) out.set(rec.id, canonicalId(state, rec.id));
    return out;
  }

  /**
   * Sections whose heading is gone (11.1): each with its last heading path,
   * its last recorded text, and whether it has history to lose.
   */
  async orphansOf(
    rel: string,
  ): Promise<{ id: SectionId; path: string[]; text: string | null; history: boolean }[]> {
    this.loaded ??= this.docIds.load();
    await this.loaded;
    const doc = await this.docIds.idFor(rel);
    const list = await this.sectionIds.orphaned(doc);
    return Promise.all(
      list.map(async (r) => ({
        id: r.id,
        path: r.path,
        text: await this.latest(doc, r.id),
        history: await this.hasHistory(doc, r.id),
      })),
    );
  }

  /** Delete an orphan's history (11.2): every device's versions of it, at once. */
  forget(rel: string, orphan: SectionId): Promise<void> {
    return this.run(async () => {
      this.loaded ??= this.docIds.load();
      await this.loaded;
      const doc = await this.docIds.idFor(rel);
      if (!(await this.sectionIds.orphaned(doc)).some((r) => r.id === orphan)) return;
      await rm(this.historyDir(doc, orphan), { recursive: true, force: true });
    });
  }

  /** Reattach an orphan to the section a person picked (11.1): its threads and history follow. */
  reattach(rel: string, orphan: SectionId, onto: SectionId): Promise<void> {
    return this.run(async () => {
      this.loaded ??= this.docIds.load();
      await this.loaded;
      await this.sectionIds.reattach(await this.docIds.idFor(rel), orphan, onto);
    });
  }

  /**
   * Applies whose outcome History doesn't record yet, as after a crash
   * between writing an Apply's version and the edit landing (Architecture,
   * "Crash recovery"): the section now holds the applied text, so it
   * landed; or the text before, so it was abandoned, and its preview is
   * still there to apply again; or neither, so a change outside Anur came
   * after it. Each outcome is written once.
   */
  private async settleApplies(doc: DocId, now: Known): Promise<void> {
    for (const [i, id] of now.ids.entries()) {
      let names: string[];
      try {
        names = (await readdir(this.historyDir(doc, id))).filter((n) => n.endsWith(".jsonl"));
      } catch {
        continue;
      }
      const lines = mergeLines(
        ...(await Promise.all(
          names.map(
            async (n) =>
              (await readJsonlFile(path.join(this.historyDir(doc, id), n), HistoryLine)).lines,
          ),
        )),
      ).sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
      const settled = new Set(lines.flatMap((l) => (l.kind === "apply-result" ? [l.preview] : [])));
      const current = subtreeOf(now, i);
      for (const [n, l] of lines.entries()) {
        if (l.kind !== "version" || l.cause !== "apply" || !l.preview || settled.has(l.preview))
          continue;
        const earlier = lines
          .slice(0, n)
          .reverse()
          .find((x) => x.kind === "version");
        const result =
          current === l.text
            ? "landed"
            : earlier?.kind === "version" && current === earlier.text
              ? "abandoned"
              : "outside";
        const w = await JsonlWriter.open(
          path.join(this.anurDir, anurPaths.history(doc, id, this.device)),
          this.device,
        );
        try {
          await w.append({ kind: "apply-result", preview: l.preview, result });
        } finally {
          await w.close();
        }
        settled.add(l.preview);
      }
    }
  }

  /**
   * A preview part is about to be applied: its version goes to History
   * first, so a crash between the two leaves a record of what was meant (3.9).
   */
  applied(
    rel: string,
    section: SectionId,
    text: string,
    sectionPath: string[],
    preview: string,
    thread: string,
  ): Promise<void> {
    return this.run(async () => {
      if (!this.recording()) return;
      this.loaded ??= this.docIds.load();
      await this.loaded;
      const doc = await this.docIds.idFor(rel);
      const w = await JsonlWriter.open(
        path.join(this.anurDir, anurPaths.history(doc, section, this.device)),
        this.device,
      );
      try {
        const before = await this.latest(doc, section);
        await w.append({
          kind: "version",
          cause: "apply",
          text,
          path: sectionPath.length > 0 ? sectionPath : [path.basename(doc)],
          summary: `From a thread: ${lower(describeChange(before, text))}`,
          preview,
          thread,
        });
      } finally {
        await w.close();
      }
    });
  }

  /**
   * Every version of one section, newest first, across devices (5.1): its
   * text, when, what caused it, its summary, and the thread behind an Apply.
   */
  async list(
    rel: string,
    text: string,
    sectionPath: readonly string[],
  ): Promise<
    {
      id: string;
      at: string;
      cause: string;
      summary: string;
      text: string;
      thread: string | null;
    }[]
  > {
    const at = await this.locate(rel, text);
    if (!at) return [];
    const index = at.tree.sections.findIndex(
      (s) => s.path.join("\u0000") === sectionPath.join("\u0000"),
    );
    const id = at.ids[index];
    if (!id) return [];
    // An orphan reattached here brings its versions with it (11.1).
    const ids = [id, ...[...at.canon].flatMap(([from, to]) => (to === id ? [from] : []))];
    const files = (
      await Promise.all(
        ids.map(async (one) => {
          const dir = this.historyDir(at.doc, one);
          const names = (await readdir(dir).catch(() => [] as string[])).filter((n) =>
            n.endsWith(".jsonl"),
          );
          return Promise.all(
            names.map(async (n) => (await readJsonlFile(path.join(dir, n), VersionLine)).lines),
          );
        }),
      )
    ).flat();
    return mergeLines(...files)
      .sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq)
      .map((l) => ({
        id: l.id,
        at: l.at,
        cause: l.cause,
        summary: l.summary,
        text: l.text,
        thread: l.thread,
      }));
  }

  /**
   * A person restored an older version of one section (5.3): the doc now
   * reads `text`, and that section's new text is recorded as a "restore"
   * version, so the typing that carried it isn't a second one.
   */
  restored(rel: string, text: string, sectionPath: readonly string[], from: string): Promise<void> {
    return this.run(async () => {
      // What was typed before the restore is a version first: no text is ever lost.
      await this.closeSession(rel);
      const before = this.known.get(rel) ?? null;
      const { doc, now } = await this.assign(rel, text, before);
      if (!now) return;
      const i = now.tree.sections.findIndex(
        (s) => s.path.join("\u0000") === sectionPath.join("\u0000"),
      );
      const id = now.ids[i];
      if (i < 0 || !id) return;
      const when = new Date(from).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      await this.write(doc, id, now, i, "restore", `Restored the version from ${when}`);
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
      // An Apply already wrote this text (3.15): typing that only carried it isn't a new version.
      if (cause === "typing" && (await this.latest(doc, id)) === subtreeOf(now, i)) continue;
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
    cause: "start" | "typing" | "outside" | "restore",
    summary: string,
  ): Promise<void> {
    const section = from.tree.sections[i];
    if (!section || !this.recording()) return;
    // A typed or outside change says what it changed (5.4).
    if (cause === "typing" || cause === "outside") {
      const said = describeChange(await this.latest(doc, id), subtreeOf(from, i));
      summary = cause === "outside" ? `Outside Anur: ${lower(said)}` : said;
    }
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

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const subtreeOf = (k: Known, i: number) => {
  const s = k.tree.sections[i];
  return s ? k.text.slice(s.subtreeRange.from, s.subtreeRange.to) : "";
};
const ownText = (k: Known, i: number) => {
  const s = k.tree.sections[i];
  return s ? k.text.slice(s.ownRange.from, s.ownRange.to) : "";
};
