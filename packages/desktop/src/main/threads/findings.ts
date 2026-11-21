/**
 * Findings kept on a doc, and which of them disagree.
 */

/** An input an earlier thread picked up, carried to a new one (4.4). */
/** A finding a person kept (16.1), as carried to new threads and listed in Think. */
export type KeptFinding = {
  /** The finding line's ID, and the thread that holds it. */
  id: string;
  thread: string;
  claim: string;
  source: string | null;
  /** The section it was kept on, by name. */
  section: string;
  at: string;
  /** A person's decision, or a finding from a source. */
  by: "source" | "person";
  /** For a decision: the person's words, who said them, what it replaced, until when. */
  quote: string | null;
  who: string | null;
  /** The decision is this person's own: Think shows no name on it. */
  mine: boolean;
  instead: string | null;
  until: string | null;
  /** "work": how the agent works, never what the doc says (kept apart in the bundle). */
  concerns?: "work" | "subject";
  /**
   * How near it is (18.3), for carrying nearest first within the budget:
   * 0 this section, 1 a section above, 2 the doc, 2.5 the part of the
   * system it's in (23.1), 3 its folder or repo, 4 everywhere.
   */
  reach: number;
  /**
   * Why it needs a look and no longer carries (18.2): its "until" has
   * passed, or the section or part it's on is gone. Null while it holds.
   */
  lapsed: "until" | "gone" | null;
  /** For a committed one kept outside any thread here: the home it's in, to keep or drop it. */
  home?: string;
  /** The decision this one goes against (18.4), by ID; and, for a committed one, the thread finding it came from. */
  against?: string | null;
  ref?: string | null;
  /**
   * Another decision here that disagrees with this one (18.4): neither
   * holds until someone picks. Where it lives, so picking this one drops it.
   */
  disputed?: {
    id: string;
    claim: string;
    who: string | null;
    thread: string;
    home?: string;
  } | null;
};

/**
 * Pairs that disagree (18.4): a decision naming another it goes against,
 * while both are still kept, marks both. A pair where one is gone is no
 * longer a disagreement: the one left holds.
 */
export function markDisputes(list: KeptFinding[]): KeptFinding[] {
  const byId = new Map<string, KeptFinding>();
  for (const f of list) {
    byId.set(f.id, f);
    if (f.ref) byId.set(f.ref, f);
  }
  const of = (f: KeptFinding) => ({
    id: f.id,
    claim: f.claim,
    who: f.who,
    thread: f.thread,
    ...(f.home !== undefined ? { home: f.home } : {}),
  });
  for (const f of list) {
    const other = f.against ? byId.get(f.against) : undefined;
    if (!other || other === f || f.by !== "person" || other.by !== "person") continue;
    f.disputed = of(other);
    other.disputed = of(f);
  }
  return list;
}
