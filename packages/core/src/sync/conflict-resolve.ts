import { applyMerge, planConflictMerge, type MergeChoices } from "./conflict-merge.ts";

/**
 * What to do with a sync conflict copy without asking anyone, as Obsidian
 * asks nothing: drop it when it adds nothing, fold it in when no writing can
 * be lost, and otherwise leave both files as notes of their own.
 *
 * `known(path)` gives earlier versions of a section from Anur's history: a
 * side whose text is an earlier version is the older one, so the other wins.
 */
export type ConflictOutcome =
  | { kind: "same" }
  | { kind: "write"; text: string; why: string }
  | { kind: "keep-original"; why: string }
  | { kind: "keep-both"; why: string };

const norm = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();

/** Whether every non-blank line of `inner` appears in `outer`, in order. */
export function containsLines(outer: string, inner: string): boolean {
  const want = norm(inner)
    .split("\n")
    .filter((l) => l.trim() !== "");
  const have = norm(outer).split("\n");
  let i = 0;
  for (const line of have) if (i < want.length && line === want[i]) i++;
  return i === want.length;
}

export function decideConflict(
  original: string,
  copy: string,
  known: (path: string[]) => readonly string[] = () => [],
): ConflictOutcome {
  if (norm(original) === norm(copy)) return { kind: "same" };
  // One device only added to what the other had.
  if (containsLines(copy, original))
    return { kind: "write", text: copy, why: "the copy has everything the original has, and more" };
  if (containsLines(original, copy))
    return { kind: "keep-original", why: "the original has everything the copy has" };

  const plan = planConflictMerge(original, copy);
  if (!plan.parts.some((p) => p.kind === "same"))
    return { kind: "keep-both", why: "the two share no section, so they're different notes" };
  const choices: MergeChoices = {};
  for (const [i, p] of plan.parts.entries()) {
    if (p.kind !== "differs") continue;
    if (containsLines(p.copy, p.original)) choices[i] = "copy";
    else if (containsLines(p.original, p.copy)) choices[i] = "original";
    else {
      // A version holds the section's whole subtree: its own text is that, or its start.
      const old = known(p.path).map(norm);
      const isOld = (own: string) => {
        const o = norm(own);
        return old.some((v) => v === o || v.startsWith(`${o}\n#`));
      };
      const oldO = isOld(p.original);
      const oldC = isOld(p.copy);
      if (oldO && !oldC) choices[i] = "copy";
      else if (oldC && !oldO) choices[i] = "original";
      else
        return {
          kind: "keep-both",
          why: `both changed "${p.path.at(-1) ?? "the top"}" differently`,
        };
    }
  }
  return {
    kind: "write",
    text: applyMerge(plan, choices),
    why: "each section changed on one side only",
  };
}
