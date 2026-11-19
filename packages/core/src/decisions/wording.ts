/**
 * How a decision reads and how far it reaches (2026-11-19 review of every
 * decision kept so far): a short statement anyone can read on its own, kept
 * no wider than the person said.
 */

/** A decision reads as a statement of at most this many words. */
export const DECISION_WORDS = 7;

/** A little room over the target before a decision is refused, so a name or number fits. */
const REFUSE_OVER = DECISION_WORDS + 1;

/**
 * What's wrong with a decision's wording, or null when it reads right: a
 * short statement of one idea, in no one's voice, not an order.
 */
export function decisionWordingProblem(decision: string): string | null {
  const words = decision.trim().split(/\s+/).filter(Boolean);
  if (words.length > REFUSE_OVER)
    return `"${decision}" is ${String(words.length)} words. State the decision in at most ${String(DECISION_WORDS)} words, such as "Three retries, not infinite." or "Task lists stay in this doc."`;
  if (/[;]/.test(decision))
    return `"${decision}" holds two ideas. Record one decision per call, each a statement of at most ${String(DECISION_WORDS)} words.`;
  if (/\b(i|i'm|i've|we|we're|we've|you|you're|my|our|your|me|us)\b/i.test(decision))
    return `"${decision}" is in someone's voice. State it as a plain statement about the work or the subject, such as "Drafts allowed, never sent."`;
  if (/^\s*(don'?t|do not|please)\b/i.test(decision))
    return `"${decision}" reads as an order. State what holds instead, such as "No code changes for retries."`;
  return null;
}

/** Words that say a decision reaches the whole folder, not just this doc. */
const FOLDER_WORDS =
  /\b(this folder|the folder|whole folder|this repo|the repo|repository|all (of )?(our|the|these) (docs|plans|projects|work)|every (doc|plan|project)|everything here|across (the |this )?(folder|repo|docs))\b/i;
/** Words that say a decision holds wherever the person works. */
const EVERYWHERE_WORDS =
  /\b(always|everywhere|every project|all projects|any project|in general|from now on,? everywhere)\b/i;

/** Words that keep a decision to one section rather than its doc. */
const SECTION_WORDS =
  /\b(this section|just (this|here)|only (this|here)|only in this (part|section)|in this part)\b/i;

type Scope = "section" | "doc" | "folder" | "everywhere";

/**
 * How far a decision reaches: its doc, unless the person's words say
 * otherwise. A folder or everywhere the quote doesn't name comes down to the
 * doc, and so does a section it doesn't name: a product decision is about the
 * doc, so the FAQ follows a choice made on the reward.
 */
export function scopeFromWords(
  quote: string,
  scope: Scope | undefined,
  _concerns: "work" | "subject" | undefined,
): Scope {
  if (scope === "everywhere")
    return EVERYWHERE_WORDS.test(quote)
      ? "everywhere"
      : FOLDER_WORDS.test(quote)
        ? "folder"
        : "doc";
  if (scope === "folder") return FOLDER_WORDS.test(quote) ? "folder" : "doc";
  if (scope === "section") return SECTION_WORDS.test(quote) ? "section" : "doc";
  return "doc";
}
