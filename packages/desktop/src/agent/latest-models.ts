/**
 * The model menu keeps only the newest of each family (Opus, Fable, Sonnet,
 * Haiku): a name like "Opus 5.5" is a family and a version, and the highest
 * version of each stays. Names without a version, such as "Default
 * (recommended)", go too. The current pick always stays, so a thread on an
 * older model still shows what it runs on.
 */
type Choice = { value: string; name: string; description: string | null };

const VERSIONED = /^([A-Za-z][A-Za-z ]*?)\s+(\d+(?:\.\d+)*)\b/;

const newer = (a: string, b: string) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
};

export function latestModels(choices: readonly Choice[], current: string): Choice[] {
  const best = new Map<string, { version: string; value: string }>();
  for (const c of choices) {
    const m = VERSIONED.exec(c.name);
    if (!m?.[1] || !m[2]) continue;
    const family = m[1].toLowerCase();
    const now = best.get(family);
    if (!now || newer(m[2], now.version)) best.set(family, { version: m[2], value: c.value });
  }
  const keep = new Set([...best.values()].map((b) => b.value));
  // Nothing recognisable: leave the menu as the agent sent it.
  if (keep.size === 0) return [...choices];
  return choices.filter((c) => keep.has(c.value) || c.value === current);
}
