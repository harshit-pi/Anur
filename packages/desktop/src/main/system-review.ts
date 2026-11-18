import type { SourcedSection } from "@anur/core";
import {
  appendReview,
  parseProposals,
  proposalPrompt,
  readReview,
  reviewState,
  type GroupBrief,
  type ReviewLine,
} from "@anur/system";

/**
 * Claude's names for the system's groups (20.6), asked once per group on the
 * person's own agent, and the person's answers (20.6a, 20.6b), kept in the
 * folder's `.anur/system/review.jsonl`.
 */

const isGroup = (s: SourcedSection) => s.id.startsWith("group:");
const isPart = (s: SourcedSection) => s.id.startsWith("part:");

/** What Claude is told about each group it hasn't been asked about. */
export function briefsFrom(
  sections: readonly SourcedSection[],
  unasked: ReadonlySet<string>,
): GroupBrief[] {
  const kids = new Map<string, SourcedSection[]>();
  for (const s of sections) if (s.parent) kids.set(s.parent, [...(kids.get(s.parent) ?? []), s]);
  const partsUnder = (id: string): string[] =>
    (kids.get(id) ?? []).flatMap((k) => (isPart(k) ? [k.path.at(-1) ?? k.id] : partsUnder(k.id)));
  return sections
    .filter((s) => isGroup(s) && unasked.has(s.id))
    .map((s) => ({
      id: s.id,
      repo: s.path[0] ?? "",
      name: s.path.at(-1) ?? "",
      within: s.path.slice(1, -1),
      parts: partsUnder(s.id),
    }));
}

export type ReviewView = {
  pending: { group: string; name: string; merge: string[] }[];
  reviewed: string[];
  asking: boolean;
  failed: string | null;
};

export class SystemReview {
  private readonly asking = new Set<string>();
  private readonly failed = new Map<string, string>();

  constructor(
    /** The folder's review changed: windows read the system again. */
    private readonly changed: (folder: string) => void,
  ) {}

  /**
   * The review as the tab shows it. Groups Claude hasn't been asked about
   * start one ask, unless one is running or the last failed this run.
   */
  view(
    folder: string,
    sections: readonly SourcedSection[],
    /** Asks the person's own agent; null when the folder has no agent yet. */
    ask: (prompt: string) => Promise<string> | null,
  ): ReviewView {
    const state = reviewState(readReview(folder));
    const groups = sections.filter(isGroup);
    const unasked = new Set(groups.map((g) => g.id).filter((id) => !state.asked.has(id)));
    if (unasked.size && !this.asking.has(folder) && !this.failed.has(folder))
      this.propose(folder, sections, unasked, ask);
    const live = new Set(groups.map((g) => g.id));
    return {
      pending: state.pending.filter((p) => live.has(p.group)),
      reviewed: [...state.reviewed],
      asking: this.asking.has(folder),
      failed: this.failed.get(folder) ?? null,
    };
  }

  /** Ask again after a failure. */
  retry(folder: string): void {
    this.failed.delete(folder);
    this.changed(folder);
  }

  decide(
    folder: string,
    d: {
      group: string;
      action: "accept" | "rename" | "dismiss";
      name?: string | undefined;
      parts: string[];
    },
  ): void {
    const at = new Date().toISOString();
    const lines: ReviewLine[] = [];
    if (d.action === "accept") lines.push({ kind: "accepted", group: d.group, at });
    else if (d.action === "dismiss") lines.push({ kind: "dismissed", group: d.group, at });
    else if (d.name?.trim())
      lines.push({ kind: "renamed", group: d.group, name: d.name.trim(), at });
    if (d.parts.length) lines.push({ kind: "reviewed", parts: d.parts, at });
    appendReview(folder, lines);
    this.changed(folder);
  }

  reviewed(folder: string, parts: string[]): void {
    appendReview(folder, [{ kind: "reviewed", parts, at: new Date().toISOString() }]);
    this.changed(folder);
  }

  private propose(
    folder: string,
    sections: readonly SourcedSection[],
    unasked: Set<string>,
    ask: (prompt: string) => Promise<string> | null,
  ) {
    const pending = ask(proposalPrompt(briefsFrom(sections, unasked)));
    if (!pending) return; // No agent for this folder yet: asked next time.
    this.asking.add(folder);
    const parentOf = new Map(sections.map((s) => [s.id, s.parent]));
    pending
      .then((reply) => {
        const at = new Date().toISOString();
        const proposals = parseProposals(reply, unasked);
        // Every group asked about is recorded, so none is asked twice.
        const lines: ReviewLine[] = [...unasked].map((group) => {
          const p = proposals.find((x) => x.group === group);
          // A merge only joins siblings, as the map shows them.
          const merge = (p?.merge ?? []).filter((m) => parentOf.get(m) === parentOf.get(group));
          const name = sections.find((s) => s.id === group)?.path.at(-1) ?? "";
          return p
            ? { kind: "proposed", group, name: p.name, ...(merge.length ? { merge } : {}), at }
            : { kind: "proposed", group, name, at };
        });
        // A proposal that keeps the rule's name and merges nothing isn't asked of the person.
        const settled: ReviewLine[] = lines.flatMap((l) =>
          l.kind === "proposed" &&
          !l.merge &&
          l.name === sections.find((s) => s.id === l.group)?.path.at(-1)
            ? [{ kind: "dismissed", group: l.group, at }]
            : [],
        );
        appendReview(folder, [...lines, ...settled]);
      })
      .catch((e: unknown) => {
        this.failed.set(folder, e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        this.asking.delete(folder);
        this.changed(folder);
      });
  }
}
