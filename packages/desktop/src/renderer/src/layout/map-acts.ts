/**
 * Actions on a box of the map (30.32): Use and Explore on a choice, as its
 * card in the thread does, so the map and the panel can never disagree.
 */

/** What a choice's box offers: its Use (named as its card names it) and whether it can be explored. */
export function choiceActs(b: {
  several?: boolean;
  notPicked?: boolean;
  explored?: boolean;
  exploring?: boolean;
}): { use: string; explore: boolean } | null {
  if (b.exploring) return null;
  return {
    use: b.several ? "Add" : b.notPicked ? "Use instead" : "Use",
    explore: !b.several && !b.explored,
  };
}

/** A thread's set of options, as far as acting on one goes. */
export type OptionSet = {
  several?: boolean;
  heading: string | null;
  used: string | null;
  added: readonly string[];
  explored: readonly string[];
  options: readonly { id: string }[];
};

/** What pressing Use or Explore on a choice's box does: the card's own call, or nothing. */
export function choicePress(
  set: OptionSet,
  option: string,
  act: "use" | "explore",
):
  | { kind: "explore" }
  | { kind: "use"; how: "replace" | "subsection"; heading: string | null }
  | null {
  if (!set.options.some((o) => o.id === option)) return null;
  if (act === "explore") return set.explored.includes(option) ? null : { kind: "explore" };
  if (set.several)
    return set.added.includes(option) ? null : { kind: "use", how: "subsection", heading: null };
  return set.used === option ? null : { kind: "use", how: "replace", heading: set.heading };
}
