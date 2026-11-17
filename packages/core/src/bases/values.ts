import type { Expr } from "./expr.ts";

/** What a base knows of one note: where it is, its properties, and its file's facts. */
export type NoteFacts = {
  /** Relative to the folder, with forward slashes. */
  path: string;
  properties: Record<string, unknown>;
  mtime: number;
  ctime: number;
  size: number;
};

/** A link value, as `link("x")` makes or a property holding "[[x]]". */
export type LinkValue = { link: string; display: string | null };
export type Value = string | number | boolean | null | LinkValue | Value[];

const WIKI = /^\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/;

/** "[[Doc|label]]" as a link value; anything else as it is. */
export function fromProperty(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(fromProperty);
  if (typeof v === "string") {
    const m = WIKI.exec(v.trim());
    return m ? { link: m[1] ?? "", display: m[2] ?? null } : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return JSON.stringify(v);
}

export const isLink = (v: Value): v is LinkValue =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A link's target as a note name: no folder, no ".md", any case. */
const linkKey = (target: string) =>
  (target.split("/").pop() ?? target).replace(/\.md$/i, "").toLowerCase();

export function equal(a: Value, b: Value): boolean {
  if (isLink(a) || isLink(b)) {
    const key = (v: Value) =>
      isLink(v) ? linkKey(v.link) : typeof v === "string" ? linkKey(v) : null;
    return key(a) !== null && key(a) === key(b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => equal(x, b[i] ?? null));
  }
  if (typeof a === "number" && typeof b === "string") return String(a) === b;
  if (typeof a === "string" && typeof b === "number") return a === String(b);
  return a === b;
}

/** Order two values: numbers as numbers, the rest as text, nothing last. */
export function compare(a: Value, b: Value): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const n = (v: Value) =>
    typeof v === "number"
      ? v
      : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)
        ? Number(v)
        : null;
  const x = n(a);
  const y = n(b);
  if (x !== null && y !== null) return x - y;
  return display(a).localeCompare(display(b), undefined, { numeric: true, sensitivity: "base" });
}

/** A value as the table shows it. */
export function display(v: Value): string {
  if (v === null) return "";
  if (Array.isArray(v)) return v.map(display).filter(Boolean).join(", ");
  if (isLink(v)) return v.display ?? (v.link.split("/").pop() ?? v.link).replace(/\.md$/i, "");
  if (typeof v === "number")
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  return String(v);
}

const truthy = (v: Value) =>
  v !== null && v !== false && v !== 0 && v !== "" && !(Array.isArray(v) && v.length === 0);

const tagsOf = (p: Record<string, unknown>): string[] => {
  const raw = p.tags ?? p.tag;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  return list.map((t) => String(t).replace(/^#/, "").toLowerCase()).filter(Boolean);
};

export type Scope = { note: NoteFacts; formula: (name: string) => Value };

/** The file's own facts: `file.name`, `file.path`, `file.folder` and the rest. */
function fileField(note: NoteFacts, name: string): Value {
  const fileName = note.path.split("/").pop() ?? note.path;
  switch (name) {
    case "name":
      return fileName;
    case "basename":
      return fileName.replace(/\.[^.]+$/, "");
    case "path":
      return note.path;
    case "folder":
      return note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/")) : "";
    case "ext":
      return /\.([^.]+)$/.exec(fileName)?.[1] ?? "";
    case "mtime":
      return note.mtime;
    case "ctime":
      return note.ctime;
    case "size":
      return note.size;
    case "tags":
      return tagsOf(note.properties);
    case "properties":
      return Object.keys(note.properties);
    default:
      throw new Error(`file.${name} isn't supported`);
  }
}

function fileMethod(note: NoteFacts, name: string, args: Value[]): Value {
  const text = (v: Value) => (isLink(v) ? v.link : display(v));
  switch (name) {
    case "inFolder": {
      const folder = text(args[0] ?? "").replace(/^\/|\/$/g, "");
      return folder === "" || note.path.startsWith(`${folder}/`);
    }
    case "hasTag": {
      const tags = tagsOf(note.properties);
      return args.some((a) => {
        const t = text(a).replace(/^#/, "").toLowerCase();
        return tags.some((x) => x === t || x.startsWith(`${t}/`));
      });
    }
    case "hasProperty":
      return text(args[0] ?? "") in note.properties;
    default:
      throw new Error(`file.${name}() isn't supported`);
  }
}

function valueMethod(v: Value, name: string, args: Value[]): Value {
  const s = display(v);
  const a = args[0] ?? null;
  switch (name) {
    case "contains":
      return Array.isArray(v) ? v.some((x) => equal(x, a)) : s.includes(display(a));
    case "startsWith":
      return s.startsWith(display(a));
    case "endsWith":
      return s.endsWith(display(a));
    case "lower":
      return s.toLowerCase();
    case "upper":
      return s.toUpperCase();
    case "isEmpty":
      return !truthy(v);
    case "toString":
      return s;
    default:
      throw new Error(`.${name}() isn't supported`);
  }
}

function callFunction(name: string, args: Value[]): Value {
  switch (name) {
    case "link": {
      const target = args[0] ?? "";
      return {
        link: isLink(target) ? target.link : display(target),
        display: args[1] ? display(args[1]) : null,
      };
    }
    case "if":
      return truthy(args[0] ?? null) ? (args[1] ?? null) : (args[2] ?? null);
    case "number": {
      const n = Number(display(args[0] ?? null));
      return Number.isFinite(n) ? n : null;
    }
    case "min":
    case "max": {
      const ns = args.filter((x): x is number => typeof x === "number");
      return ns.length ? Math[name](...ns) : null;
    }
    case "today":
      return new Date().toISOString().slice(0, 10);
    case "now":
      return Date.now();
    default:
      throw new Error(`${name}() isn't supported`);
  }
}

function arithmetic(op: string, a: Value, b: Value): Value {
  if (op === "+" && (typeof a === "string" || typeof b === "string"))
    return display(a) + display(b);
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  if (op === "/") return b === 0 ? null : a / b;
  return b === 0 ? null : a % b;
}

/** Work an expression out for one note. Throws on what isn't supported. */
export function evaluate(e: Expr, scope: Scope): Value {
  const { note } = scope;
  const property = (name: string) => fromProperty(note.properties[name]);
  switch (e.kind) {
    case "literal":
      return e.value;
    case "name":
      if (e.name === "note" || e.name === "file" || e.name === "formula" || e.name === "this") {
        throw new Error(`"${e.name}" needs a property after it`);
      }
      return property(e.name);
    case "member":
    case "index": {
      const key = e.kind === "member" ? e.name : display(evaluate(e.index, scope));
      if (e.object.kind === "name") {
        if (e.object.name === "note") return property(key);
        if (e.object.name === "file") return fileField(note, key);
        if (e.object.name === "formula") return scope.formula(key);
        if (e.object.name === "this") return null;
      }
      const object = evaluate(e.object, scope);
      if (key === "length") return Array.isArray(object) ? object.length : display(object).length;
      throw new Error(`".${key}" isn't supported`);
    }
    case "call": {
      const args = e.args.map((a) => evaluate(a, scope));
      if (e.callee.kind === "name") return callFunction(e.callee.name, args);
      if (e.callee.kind === "member") {
        const { object, name } = e.callee;
        if (object.kind === "name" && object.name === "file") return fileMethod(note, name, args);
        return valueMethod(evaluate(object, scope), name, args);
      }
      throw new Error("that call isn't supported");
    }
    case "unary": {
      const v = evaluate(e.arg, scope);
      return e.op === "!" ? !truthy(v) : typeof v === "number" ? -v : null;
    }
    case "binary": {
      if (e.op === "&&") return truthy(evaluate(e.left, scope)) && truthy(evaluate(e.right, scope));
      if (e.op === "||") return truthy(evaluate(e.left, scope)) || truthy(evaluate(e.right, scope));
      const a = evaluate(e.left, scope);
      const b = evaluate(e.right, scope);
      switch (e.op) {
        case "==":
          return equal(a, b);
        case "!=":
          return !equal(a, b);
        case ">":
        case "<":
        case ">=":
        case "<=": {
          if (a === null || b === null) return false;
          const c = compare(a, b);
          return e.op === ">" ? c > 0 : e.op === "<" ? c < 0 : e.op === ">=" ? c >= 0 : c <= 0;
        }
        default:
          return arithmetic(e.op, a, b);
      }
    }
  }
}

export { truthy };
