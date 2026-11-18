/**
 * The person's review of the system (20.6): Claude's proposed names and
 * merges for groups, what the person accepted, renamed or dismissed, and
 * which parts they have seen. Lines in `.anur/system/review.jsonl` in the
 * opened folder; groups are keyed by their section ID, so a regrouping by
 * rule never mints new IDs (Internals §1) and a correction outlives rescans.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PartGroup } from "./groups.ts";

export type ReviewLine =
  | { kind: "proposed"; group: string; name: string; merge?: string[]; at: string }
  | { kind: "accepted"; group: string; at: string }
  | { kind: "renamed"; group: string; name: string; at: string }
  | { kind: "dismissed"; group: string; at: string }
  | { kind: "reviewed"; parts: string[]; at: string };

export const reviewFile = (folder: string) => path.join(folder, ".anur", "system", "review.jsonl");

export function readReview(folder: string): ReviewLine[] {
  let text: string;
  try {
    text = readFileSync(reviewFile(folder), "utf8");
  } catch {
    return [];
  }
  const out: ReviewLine[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const l = JSON.parse(line) as ReviewLine;
      if (typeof l.kind === "string") out.push(l);
    } catch {
      // A torn last line from a crash: skipped.
    }
  }
  return out;
}

export function appendReview(folder: string, lines: ReviewLine[]): void {
  if (!lines.length) return;
  mkdirSync(path.dirname(reviewFile(folder)), { recursive: true });
  appendFileSync(reviewFile(folder), lines.map((l) => JSON.stringify(l) + "\n").join(""));
}

export type Proposal = { group: string; name: string; merge: string[] };

export type ReviewState = {
  /** The name each group shows: a rename, else an accepted proposal. */
  names: Map<string, string>;
  /** Groups an accepted proposal folds into another, by the group that keeps them. */
  merges: Map<string, string[]>;
  /** Proposals waiting on the person. */
  pending: Proposal[];
  /** Groups Claude has been asked about, so it is asked once. */
  asked: Set<string>;
  /** Parts the person has seen. */
  reviewed: Set<string>;
};

/** The review as it stands: the last word on each group wins. */
export function reviewState(lines: readonly ReviewLine[]): ReviewState {
  const proposals = new Map<string, Proposal>();
  const settled = new Map<string, "accepted" | "renamed" | "dismissed">();
  const names = new Map<string, string>();
  const reviewed = new Set<string>();
  for (const l of lines) {
    if (l.kind === "proposed") {
      proposals.set(l.group, { group: l.group, name: l.name, merge: l.merge ?? [] });
      settled.delete(l.group);
    } else if (l.kind === "accepted") {
      const p = proposals.get(l.group);
      if (p) names.set(l.group, p.name);
      settled.set(l.group, "accepted");
    } else if (l.kind === "renamed") {
      names.set(l.group, l.name);
      settled.set(l.group, "renamed");
    } else if (l.kind === "dismissed") settled.set(l.group, "dismissed");
    else for (const p of l.parts) reviewed.add(p);
  }
  const merges = new Map<string, string[]>();
  for (const [g, how] of settled) {
    const merge = proposals.get(g)?.merge ?? [];
    if (how === "accepted" && merge.length) merges.set(g, merge);
  }
  const pending = [...proposals.values()].filter((p) => !settled.has(p.group));
  return { names, merges, pending, asked: new Set(proposals.keys()), reviewed };
}

/**
 * Groups with the person's names and accepted merges applied. `idOf` gives a
 * group's section ID from its key. A merged group's parts and subgroups join
 * the group that keeps them, among the same siblings only.
 */
export function applyReview(
  groups: readonly PartGroup[],
  idOf: (key: string) => string,
  state: ReviewState,
): PartGroup[] {
  const byId = new Map(groups.map((g) => [idOf(g.key), g]));
  const gone = new Set<string>();
  const out: PartGroup[] = [];
  for (const g of groups) {
    const id = idOf(g.key);
    if (gone.has(id)) continue;
    let parts = [...g.parts];
    let subs = g.groups ? [...g.groups] : undefined;
    for (const m of state.merges.get(id) ?? []) {
      const other = byId.get(m);
      if (!other || other === g) continue;
      gone.add(m);
      parts = [...parts, ...other.parts];
      if (other.groups) subs = [...(subs ?? []), ...other.groups];
      else if (subs) subs.push(other);
    }
    out.push({
      ...g,
      name: state.names.get(id) ?? g.name,
      parts,
      ...(subs ? { groups: applyReview(subs, idOf, state) } : {}),
    });
  }
  // A group merged away before its keeper came up in the list is dropped here.
  return out.filter((g) => !gone.has(idOf(g.key)));
}

/** What Claude is asked about one group, at most 40 part names. */
export type GroupBrief = {
  id: string;
  repo: string;
  /** The group's own name, never its path. */
  name: string;
  /** The groups it sits in, outermost first; empty at the repo's top. */
  within: string[];
  parts: string[];
};

/** The question for the person's agent: names and merges, as JSON, nothing else. */
export function proposalPrompt(groups: readonly GroupBrief[]): string {
  return [
    "You are naming groups of parts in a software system, so a person can find their way around a map of it.",
    "Each group was made by a rule from the parts' names. Propose a better name only where it clearly helps, especially for groups called Other or Services.",
    "A name is one to three plain words a developer on this team would use, such as Copy trading or Brokerage webhooks. Give the group's own name only, never the groups it sits in.",
    "You may also propose merging small groups in the same repo and level into one, by listing the others' ids in merge.",
    'Do not use any tools. Reply with a JSON array only, no prose, of objects {"id": string, "name": string, "merge": string[]}. Leave out groups whose name is already right.',
    "",
    JSON.stringify(groups.map((g) => ({ ...g, parts: g.parts.slice(0, 40) }))),
  ].join("\n");
}

/** Proposals read from the agent's reply; anything not about a known group is dropped. */
export function parseProposals(reply: string, known: ReadonlySet<string>): Proposal[] {
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Proposal[] = [];
  for (const x of raw as unknown[]) {
    if (!x || typeof x !== "object") continue;
    const { id, name, merge } = x as { id?: unknown; name?: unknown; merge?: unknown };
    if (typeof id !== "string" || !known.has(id) || typeof name !== "string") continue;
    // A name given as a path, "Services › Brokerage", keeps its last step.
    const clean = (name.split(/\s*[›>/]\s*/).at(-1) ?? "").trim().slice(0, 60);
    if (!clean) continue;
    const others = Array.isArray(merge)
      ? merge.filter((m): m is string => typeof m === "string" && known.has(m) && m !== id)
      : [];
    out.push({ group: id, name: clean, merge: others });
  }
  return out;
}
