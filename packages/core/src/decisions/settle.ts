/**
 * When a decision settles by itself (decisions, core). The agent proposes
 * a decision with the person's exact words and its confidence; it settles
 * with no click only when all three hold:
 *
 * - the quote is word for word in something the person typed in the thread,
 *   so nothing is ever put in their mouth;
 * - the words aren't a question ("we shouldn't send in preview, right?"),
 *   which may be a decision but is never settled silently;
 * - the agent is confident it's lasting, at or above SETTLE_AT. Opus at 0.7
 *   kept 92% right in the 2026-11-18 eval on 286 real messages.
 *
 * Otherwise it waits for a person's Keep, or is refused when the quote
 * isn't theirs.
 */

export const SETTLE_AT = 0.7;

const norm = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** The person message the quote is from, word for word (case and spacing aside), or null. */
export function quotedFrom<T extends { text: string }>(
  quote: string,
  said: readonly T[],
): T | null {
  const q = norm(quote).replace(/^["']|["']$/g, "");
  if (q.length < 3) return null;
  for (let i = said.length - 1; i >= 0; i--) {
    const m = said[i];
    if (m && norm(m.text).includes(q)) return m;
  }
  return null;
}

/** Whether the words read as a question: they end in one, or the sentence holding them does. */
export function isQuestion(quote: string, message: string): boolean {
  if (/\?\s*$/.test(quote.trim())) return true;
  const at = norm(message).indexOf(norm(quote));
  if (at < 0) return false;
  const rest = norm(message).slice(at + norm(quote).length);
  const end = /[.!?\n]/.exec(rest);
  return end?.[0] === "?";
}

export type Settle =
  | { kind: "settle"; from: string }
  | { kind: "propose"; from: string; why: "unsure" | "question" }
  | { kind: "refuse"; reason: string };

export function settleRule(
  quote: string,
  confidence: number,
  said: readonly { id: string; text: string }[],
): Settle {
  const m = quotedFrom(quote, said);
  if (!m)
    return {
      kind: "refuse",
      reason:
        "That quote isn't in anything the person typed in this thread. Use their exact words, or don't record it.",
    };
  if (isQuestion(quote, m.text)) return { kind: "propose", from: m.id, why: "question" };
  if (!(confidence >= SETTLE_AT)) return { kind: "propose", from: m.id, why: "unsure" };
  return { kind: "settle", from: m.id };
}
