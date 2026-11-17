import { z } from "zod";
import { LineEnvelope, compareLines } from "../jsonl/lines.ts";
import { SectionId, type DocId } from "../sections/section.ts";
import { mintId } from "./mint.ts";

/**
 * Section IDs and the ID log (task 1.12; Data Model, "Keeping section IDs
 * stable"). Each device writes one line per event to the doc's
 * `docs/<doc>/ids/<device>.jsonl`. The five kinds:
 *
 * - mint: a new ID for a heading path and ordinal;
 * - rename: the same section under a new heading path;
 * - alias: a second ID for one section joins the earliest mint;
 * - orphaned: the heading is gone; its ID is never picked up by a new heading;
 * - reattach: an orphan's threads and history join the section a person picks.
 */
const HeadingPath = z.array(z.string()).min(1);

export const SectionMintLine = LineEnvelope.extend({
  kind: z.literal("mint"),
  section: SectionId,
  path: HeadingPath,
  ordinal: z.int().nonnegative(),
});
export const SectionRenameLine = LineEnvelope.extend({
  kind: z.literal("rename"),
  section: SectionId,
  from: HeadingPath,
  to: HeadingPath,
});
export const SectionAliasLine = LineEnvelope.extend({
  kind: z.literal("alias"),
  section: SectionId,
  /** The ID it joins: the earliest mint for the section. */
  to: SectionId,
  path: HeadingPath,
});
export const SectionOrphanedLine = LineEnvelope.extend({
  kind: z.literal("orphaned"),
  section: SectionId,
  path: HeadingPath,
});
export const SectionReattachLine = LineEnvelope.extend({
  kind: z.literal("reattach"),
  section: SectionId,
  /** The live section the orphan's threads and history now belong to. */
  onto: SectionId,
  path: HeadingPath,
});

export const SectionIdLine = z.discriminatedUnion("kind", [
  SectionMintLine,
  SectionRenameLine,
  SectionAliasLine,
  SectionOrphanedLine,
  SectionReattachLine,
]);
export type SectionIdLine = z.infer<typeof SectionIdLine>;
type Payload<T> = T extends unknown ? Omit<T, "id" | "at" | "dev" | "seq"> : never;
export type SectionIdEvent = Payload<SectionIdLine>;

export type IdRecord = {
  id: SectionId;
  /** Its latest heading path. */
  path: string[];
  /** Order of minting across devices, earliest first. */
  mintOrder: number;
  mintDev: string;
  mintOrdinal: number;
  orphaned: boolean;
  /** Set by alias or reattach: the ID this one now stands for. */
  joinedTo: SectionId | null;
};

/** One doc's IDs, rebuilt from every device's ID log in merged order. */
export type SectionIdState = Map<SectionId, IdRecord>;

export function buildSectionIdState(lines: readonly SectionIdLine[]): SectionIdState {
  const state: SectionIdState = new Map();
  let order = 0;
  for (const l of [...lines].sort(compareLines)) {
    const rec = state.get(l.section);
    switch (l.kind) {
      case "mint":
        if (!rec) {
          state.set(l.section, {
            id: l.section,
            path: l.path,
            mintOrder: order++,
            mintDev: l.dev,
            mintOrdinal: l.ordinal,
            orphaned: false,
            joinedTo: null,
          });
        }
        break;
      case "rename":
        if (rec) rec.path = l.to;
        break;
      case "alias":
        if (rec) rec.joinedTo = l.to;
        break;
      case "orphaned":
        if (rec) rec.orphaned = true;
        break;
      case "reattach":
        if (rec) {
          rec.joinedTo = l.onto;
          rec.orphaned = false;
        }
        break;
    }
  }
  return state;
}

/** The ID a section is known by now, following aliases and reattaches. */
export function canonicalId(state: SectionIdState, id: SectionId): SectionId {
  let current = id;
  for (let i = 0; i < 64; i++) {
    const next = state.get(current)?.joinedTo;
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

const key = (path: readonly string[]) => path.join("\u0000");
const samePath = (a: readonly string[], b: readonly string[]) => key(a) === key(b);

export type SectionToSave = {
  path: string[];
  ordinal: number;
  /** The ID the editor carried on this heading through edits, if any. */
  carried?: SectionId | null;
};

/**
 * Assign IDs to a doc's sections at save, and return the ID-log events to write.
 *
 * 1. An ID the editor carried is kept; a changed path writes a rename.
 * 2. Otherwise a live ID whose latest path matches is used, earliest mint first.
 * 3. Otherwise a new ID is minted from the doc, the heading path and the ordinal.
 * 4. A live ID left over is orphaned, unless another device minted it for the
 *    same heading, in which case it joins the earliest mint as an alias.
 */
export function assignSectionIds(
  state: SectionIdState,
  doc: DocId,
  sections: readonly SectionToSave[],
): { ids: SectionId[]; events: SectionIdEvent[] } {
  const events: SectionIdEvent[] = [];
  const used = new Set<SectionId>();
  const ids: (SectionId | null)[] = sections.map(() => null);
  const live = (r: IdRecord) => !r.orphaned && r.joinedTo === null;

  sections.forEach((s, i) => {
    if (!s.carried) return;
    const id = canonicalId(state, s.carried);
    const rec = state.get(id);
    if (!rec || !live(rec) || used.has(id)) return;
    if (!samePath(rec.path, s.path))
      events.push({ kind: "rename", section: id, from: rec.path, to: s.path });
    used.add(id);
    ids[i] = id;
  });

  const byPath = new Map<string, IdRecord[]>();
  for (const r of [...state.values()].sort((a, b) => a.mintOrder - b.mintOrder)) {
    if (!live(r) || used.has(r.id)) continue;
    const list = byPath.get(key(r.path)) ?? [];
    list.push(r);
    byPath.set(key(r.path), list);
  }
  sections.forEach((s, i) => {
    if (ids[i]) return;
    const match = byPath.get(key(s.path))?.shift();
    if (match) {
      used.add(match.id);
      ids[i] = match.id;
    }
  });

  const minted = new Set<string>();
  sections.forEach((s, i) => {
    if (ids[i]) return;
    const raw = mintId(
      ["section", doc, ...s.path, String(s.ordinal)],
      (c) => state.has(c as SectionId) || minted.has(c),
    );
    const id = SectionId.parse(raw);
    minted.add(raw);
    used.add(id);
    ids[i] = id;
    events.push({ kind: "mint", section: id, path: s.path, ordinal: s.ordinal });
  });

  for (const leftovers of byPath.values()) {
    for (const r of leftovers) {
      const twin = [...used]
        .map((u) => state.get(u))
        .find(
          (u) =>
            u &&
            samePath(u.path, r.path) &&
            u.mintOrdinal === r.mintOrdinal &&
            u.mintDev !== r.mintDev,
        );
      if (twin) events.push({ kind: "alias", section: r.id, to: twin.id, path: r.path });
      else events.push({ kind: "orphaned", section: r.id, path: r.path });
    }
  }

  return {
    ids: ids.map((id) => {
      if (!id) throw new Error("assignSectionIds: a section got no ID");
      return id;
    }),
    events,
  };
}

/** The orphaned IDs of a doc, for the orphaned list. */
export function orphanedIds(state: SectionIdState): IdRecord[] {
  return [...state.values()].filter((r) => r.orphaned && r.joinedTo === null);
}
