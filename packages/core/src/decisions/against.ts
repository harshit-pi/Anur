/**
 * Which kept decision a new one goes against (18.4), from its words as the
 * agent saw them listed: the same words, else the one whose words hold the
 * other's. Null when none matches, or more than one does.
 */
export function decisionNamed(
  words: string,
  decisions: readonly { id: string; claim: string }[],
): string | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const want = norm(words);
  if (!want) return null;
  const same = decisions.filter((d) => norm(d.claim) === want);
  if (same.length === 1) return same[0]?.id ?? null;
  if (same.length > 1) return null;
  const holds = decisions.filter((d) => {
    const c = norm(d.claim);
    return c.length > 0 && (c.includes(want) || want.includes(c));
  });
  return holds.length === 1 ? (holds[0]?.id ?? null) : null;
}
