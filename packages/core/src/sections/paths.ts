/** Two heading paths name the same section; a missing one never matches. */
export const samePath = (
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/** A section's text without its own heading line. */
export const withoutHeading = (text: string): string => text.replace(/^#{1,6}[ \t].*\n?/, "");
