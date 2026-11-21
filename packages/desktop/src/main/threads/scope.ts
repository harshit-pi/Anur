/**
 * Which sections a thread, finding or decision reaches, by its scope and where the doc's sections are now.
 */
import { DocId, sectionScope, type SectionId, type SectionTree } from "@anur/core";

export type Located = {
  doc: DocId;
  tree: SectionTree;
  ids: SectionId[];
  /** IDs joined to another by an alias or a Reattach, to the ID they stand for (11.1). */
  canon?: ReadonlyMap<SectionId, SectionId>;
};

/** A section's place in the tree by its ID, following aliases and Reattaches. */
export const indexIn = (at: Located, id: SectionId): number =>
  at.ids.indexOf(at.canon?.get(id) ?? id);

/** How near a committed decision's scope is to a section (18.3); see `KeptFinding.reach`. */
export function reachOf(scope: string, here: readonly string[]): number {
  const section = /^section:[^#]+#(.*)$/s.exec(scope);
  if (section) {
    const at = section[1] ? section[1].split(" › ") : [];
    return at.length === 0 ? 2 : at.length === here.length ? 0 : 1;
  }
  // A part's sits between the doc and its repo (23.1).
  if (scope.startsWith("part:")) return 2.5;
  return scope === "everywhere" ? 4 : 3;
}

/**
 * Whether a committed decision reaches a doc's section, and what it's on, by
 * name: a section's own scope reaches it and the sections below; a decision
 * for a whole repo or a folder in it, as one made from a terminal session
 * (23.4), reaches every doc inside. Null when it doesn't reach this one.
 */
export function appliesTo(
  scope: string,
  home: string,
  rel: string,
  here: readonly string[],
  /** For a part's decision, its name and the folder it covers; see `CommittedEntry.within`. */
  part: { on?: string | null | undefined; within?: string | null | undefined } = {},
): string | null {
  const section = sectionScope(scope, home);
  if (section)
    return section.doc === rel && section.path.every((p, i) => here[i] === p)
      ? (section.path.at(-1) ?? "this doc")
      : null;
  if (scope === "everywhere") return "everywhere";
  const inside = (dir: string) => !dir || rel.startsWith(`${dir}/`);
  if (scope === "repo") return inside(home) ? (home ? `all of ${home}` : "the whole folder") : null;
  const folder = /^folder:(.+)$/.exec(scope)?.[1];
  if (folder) {
    const dir = home ? `${home}/${folder}` : folder;
    return inside(dir) ? `all of ${dir}` : null;
  }
  // A part's reaches docs in the folder it covers (23.1); a line's waits for 23.10.
  if (scope.startsWith("part:") && typeof part.within === "string") {
    const dir = [home, part.within].filter(Boolean).join("/");
    return inside(dir) ? (part.on ?? `all of ${dir || "the folder"}`) : null;
  }
  return null;
}

/**
 * Where a decision was, when that place is gone (18.2): a section of this
 * doc no longer in it, or a part the system no longer has. Null otherwise.
 */
export function goneFrom(
  e: {
    scope: string;
    home: string;
    on?: string | null | undefined;
    within?: string | null | undefined;
  },
  rel: string,
  at: { tree: { sections: readonly { path: readonly string[] }[] } },
  parts: ReadonlySet<string> | null,
): string | null {
  const section = sectionScope(e.scope, e.home);
  if (section) {
    if (section.doc !== rel || !section.path.length) return null;
    const want = section.path.join("\u0000");
    return at.tree.sections.some((s) => s.path.join("\u0000") === want)
      ? null
      : `${section.path.join(" › ")}, which is gone`;
  }
  const part = /^part:(.+)$/.exec(e.scope)?.[1];
  // Only on docs it reached while the part was there.
  if (part && parts && !parts.has(part) && appliesTo(e.scope, e.home, rel, [], e) !== null)
    return `${e.on ?? "a part"}, which is gone`;
  return null;
}

export const canonIn = (at: Located, id: SectionId) => at.canon?.get(id) ?? id;
