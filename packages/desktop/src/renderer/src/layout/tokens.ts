/** A token count as people read it: 840, 12.4k, 1.2M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 100 ? k.toFixed(1).replace(/\.0$/, "") : String(Math.round(k))}k`;
  }
  const m = n / 1_000_000;
  return `${m < 100 ? m.toFixed(1).replace(/\.0$/, "") : String(Math.round(m))}M`;
}
