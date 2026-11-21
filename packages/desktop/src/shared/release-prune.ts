/**
 * Which past versions' files to delete from the release bucket after a
 * release: all but the newest few. Updates only ever fetch the newest; older
 * ones are kept a while to reach a recent build again. Only a version's own
 * files are touched, never the feed, the stable links or anything else.
 */
const VERSIONED = /^Anur-(\d+)\.(\d+)\.(\d+)-.+$/;

const parse = (key: string): [number, number, number] | null => {
  const m = VERSIONED.exec(key);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const newerFirst = (a: [number, number, number], b: [number, number, number]) =>
  b[0] - a[0] || b[1] - a[1] || b[2] - a[2];

export function toPrune(keys: readonly string[], current: string, keep = 5): string[] {
  const versions = new Map<string, [number, number, number]>();
  for (const k of keys) {
    const v = parse(k);
    if (v) versions.set(v.join("."), v);
  }
  const kept = new Set(
    [...versions.entries()]
      .sort((a, b) => newerFirst(a[1], b[1]))
      .slice(0, keep)
      .map(([name]) => name),
  );
  // The version just released stays, whatever else is in the bucket.
  kept.add(current);
  return keys.filter((k) => {
    const v = parse(k);
    return v !== null && !kept.has(v.join("."));
  });
}
