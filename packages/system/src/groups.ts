/**
 * Groups for a repo with many parts, so the map opens one level at a time
 * (group 20). A repo with up to MAX parts lists them as they are. Above
 * that, parts group by what their name says they are (tables, queues…);
 * a group still above MAX splits by its parts' shared first word. Groups
 * are a view, by rule: they never change a part's ID, and the model's
 * proposals (20.6) may rename or merge them later.
 */

/** The most boxes one level shows before it groups. */
export const MAX = 12;

export type PartGroup = {
  /** Stable within the repo: `kind` or `kind/word`. */
  key: string;
  name: string;
  /** Part names, in their given order. */
  parts: string[];
  /** Subgroups, when this group was itself too big. */
  groups?: PartGroup[];
};

/** Kinds read from a part's name, first match wins. */
const KINDS: { key: string; name: string; test: RegExp }[] = [
  { key: "tables", name: "Tables", test: /dynamo|table/i },
  { key: "queues", name: "Queues", test: /sqs|queue/i },
  { key: "storage", name: "Storage", test: /s3|bucket|storage/i },
  { key: "topics", name: "Topics", test: /sns|topic/i },
  { key: "secrets", name: "Keys and secrets", test: /api_?key|credential|secret|key(stack)?$/i },
  { key: "cache", name: "Caches", test: /redis|cache/i },
  { key: "monitoring", name: "Monitoring", test: /monitor|dashboard|alarm|log_?retention/i },
  { key: "schedules", name: "Schedules", test: /schedule|cron/i },
];

/** The words of a name: `IBKRWebhookStack` → IBKR, Webhook, Stack. */
export function wordsOf(name: string): string[] {
  return name
    .replace(/[_\-.\s]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean);
}

function kindOf(name: string): (typeof KINDS)[number] | null {
  return KINDS.find((k) => k.test.test(name)) ?? null;
}

/** One form per word: lower case, and "users" as "user". */
const stem = (w: string) => {
  const l = w.toLowerCase();
  return l.length > 3 && l.endsWith("s") && !l.endsWith("ss") ? l.slice(0, -1) : l;
};

/** Words that say nothing about what a part does. */
const PLAIN = new Set(
  "stack trading dynamo db dynamodb sqs sns s3 queue table v1 v2 v3 imported pi the and service".split(
    " ",
  ),
);

/**
 * Splits a big group by shared words: the word most of its parts share
 * becomes a group, then the next, while a word is shared by two or more;
 * the rest go to "Other".
 */
function bySharedWord(key: string, names: string[]): PartGroup[] {
  const words = new Map(
    names.map((n) => [
      n,
      new Set(
        wordsOf(n)
          .map(stem)
          .filter((w) => !PLAIN.has(w)),
      ),
    ]),
  );
  const out: PartGroup[] = [];
  let left = [...names];
  for (;;) {
    const count = new Map<string, number>();
    for (const n of left) for (const w of words.get(n) ?? []) count.set(w, (count.get(w) ?? 0) + 1);
    const best = [...count]
      // A word all the rest share names them, unless it would be the only group.
      .filter(([, c]) => c > 1 && (c < left.length || out.length > 0))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!best) break;
    const [w] = best;
    const ns = left.filter((n) => words.get(n)?.has(w));
    const forms = ns.flatMap((n) => wordsOf(n).filter((x) => stem(x) === w));
    const found = forms.sort((a, b) => a.length - b.length)[0] ?? w;
    const label = found.charAt(0).toUpperCase() + found.slice(1);
    out.push({ key: `${key}/${w}`, name: label, parts: ns });
    left = left.filter((n) => !ns.includes(n));
  }
  if (left.length) out.push({ key: `${key}/other`, name: "Other", parts: left });
  // Splitting only helps when it makes fewer boxes than it holds.
  return out.length > 1 && out.length < names.length ? out : [];
}

/**
 * A repo's parts as groups, or null when they fit on one level. Kinds with a
 * single part fold into "Services", so no group holds just one box.
 */
export function groupParts(names: string[], max = MAX): PartGroup[] | null {
  if (names.length <= max) return null;
  const by = new Map<string, string[]>();
  for (const n of names) {
    const k = kindOf(n)?.key ?? "services";
    by.set(k, [...(by.get(k) ?? []), n]);
  }
  for (const [k, ns] of by)
    if (k !== "services" && ns.length < 2) {
      by.delete(k);
      by.set("services", [...(by.get("services") ?? []), ...ns]);
    }
  const order = [...KINDS.map((k) => k.key), "services"];
  const groups: PartGroup[] = [];
  for (const key of order) {
    const ns = by.get(key);
    if (!ns) continue;
    const name = KINDS.find((k) => k.key === key)?.name ?? "Services";
    const sorted = names.filter((n) => ns.includes(n));
    const g: PartGroup = { key, name, parts: sorted };
    if (sorted.length > max) {
      const sub = bySharedWord(key, sorted);
      if (sub.length) g.groups = sub;
    }
    groups.push(g);
  }
  // One group is no grouping at all.
  return groups.length > 1 ? groups : null;
}
