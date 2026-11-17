/**
 * Frontmatter as fields (task 2.13): each "key: value" is a field whose value
 * is one text or a list. When written back, a field nobody changed keeps its
 * original lines, comments and quoting included. YAML that isn't this simple
 * isn't read as fields at all, so the page shows it as written.
 */

export type FieldKind = "text" | "empty" | "inline-list" | "block-list";

export type Field = {
  key: string;
  values: string[];
  kind: FieldKind;
  /** The lines as written, until the field is edited. */
  original: string[] | null;
};

export type Properties = {
  /** Lines before the first field, such as comments. */
  lead: string[];
  fields: Field[];
};

const unquote = (s: string) => {
  const t = s.trim();
  const m = /^(["'])(.*)\1$/.exec(t);
  if (!m) return t;
  return m[1] === '"' ? (m[2] ?? "").replace(/\\(["\\])/g, "$1") : (m[2] ?? "").replace(/''/g, "'");
};

/** Split "[a, b]" at commas outside quotes. */
function inlineItems(inner: string): string[] {
  const items: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const c of inner) {
    if (quote) {
      if (c === quote) quote = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ",") {
      items.push(cur);
      cur = "";
    } else cur += c;
  }
  items.push(cur);
  return items.map(unquote).filter((v) => v !== "");
}

const KEY_LINE = /^([A-Za-z0-9_][\w .-]*?)\s*:(?:\s+(.*?))?\s*$/;
const ITEM_LINE = /^\s+-\s+(.*)$/;

export function parseFields(yaml: string): Properties | null {
  const lead: string[] = [];
  const fields: Field[] = [];
  for (const line of yaml === "" ? [] : yaml.split("\n")) {
    const last = fields.at(-1);
    if (line.trim() === "" || line.trim().startsWith("#")) {
      if (last?.original) last.original.push(line);
      else lead.push(line);
      continue;
    }
    const item = ITEM_LINE.exec(line);
    if (item && last && (last.kind === "empty" || last.kind === "block-list")) {
      last.kind = "block-list";
      last.values.push(unquote(item[1] ?? ""));
      last.original?.push(line);
      continue;
    }
    const kv = KEY_LINE.exec(line);
    if (!kv?.[1] || line.startsWith(" ")) return null;
    const value = kv[2] ?? "";
    if (value === "" || value.startsWith("#")) {
      fields.push({ key: kv[1], values: [], kind: "empty", original: [line] });
    } else if (value.startsWith("[") && value.endsWith("]") && !value.startsWith("[[")) {
      fields.push({
        key: kv[1],
        values: inlineItems(value.slice(1, -1)),
        kind: "inline-list",
        original: [line],
      });
    } else if (/^[|>{&*!]/.test(value)) {
      // Block scalars, maps, anchors and tags: not simple enough to show.
      return null;
    } else {
      fields.push({ key: kv[1], values: [unquote(value)], kind: "text", original: [line] });
    }
  }
  return { lead, fields };
}

/** Quote a value only when YAML would read it differently otherwise. */
export function yamlValue(v: string, inList = false): string {
  const risky =
    v === "" ||
    /^[\s[\]{}#&*!|>'"%@`,?:-]/.test(v) ||
    /\s$/.test(v) ||
    /: |\s#/.test(v) ||
    (inList && /[,\]]/.test(v));
  return risky ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : v;
}

function fieldLines(f: Field): string[] {
  if (f.original) return f.original;
  switch (f.kind) {
    case "empty":
      return [`${f.key}:`];
    case "text":
      return [`${f.key}: ${yamlValue(f.values[0] ?? "")}`];
    case "inline-list":
      return [`${f.key}: [${f.values.map((v) => yamlValue(v, true)).join(", ")}]`];
    case "block-list":
      return [`${f.key}:`, ...f.values.map((v) => `  - ${yamlValue(v)}`)];
  }
}

export function serializeFields(p: Properties): string {
  return [...p.lead, ...p.fields.flatMap(fieldLines)].join("\n");
}

/** The frontmatter block as a whole, fences included. */
export const frontmatter = (p: Properties) => {
  const body = serializeFields(p);
  return body === "" ? "---\n---" : `---\n${body}\n---`;
};

const edited = (p: Properties, i: number, change: (f: Field) => Field): Properties => ({
  ...p,
  fields: p.fields.map((f, j) => (j === i ? { ...change(f), original: null } : f)),
});

export function setKey(p: Properties, i: number, key: string): Properties {
  const clean = key.replace(/[:\n]/g, " ").trim();
  if (!clean || p.fields[i]?.key === clean) return p;
  return edited(p, i, (f) => ({ ...f, key: clean }));
}

/** A value as typed: a list's items separated by commas; a text as it is. */
export function setValue(p: Properties, i: number, typed: string): Properties {
  const f = p.fields[i];
  if (!f) return p;
  const text = typed.replace(/\n/g, " ");
  const list = f.kind === "inline-list" || f.kind === "block-list";
  const values = list
    ? text
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : [text.trim()].filter(Boolean);
  if (JSON.stringify(values) === JSON.stringify(f.values)) return p;
  const kind: FieldKind = list ? f.kind : values.length ? "text" : "empty";
  return edited(p, i, (x) => ({ ...x, values, kind }));
}

/** The value as the person edits it. */
export const valueText = (f: Field) => f.values.join(", ");

export function addField(p: Properties, key = "property"): Properties {
  const taken = new Set(p.fields.map((f) => f.key));
  let name = key;
  for (let n = 2; taken.has(name); n++) name = `${key} ${String(n)}`;
  return {
    ...p,
    fields: [...p.fields, { key: name, values: [], kind: "empty", original: null }],
  };
}

export function removeField(p: Properties, i: number): Properties {
  return { ...p, fields: p.fields.filter((_, j) => j !== i) };
}
