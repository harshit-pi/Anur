import { parse } from "yaml";
import { type Expr, parseExpr } from "./expr.ts";
import {
  type NoteFacts,
  type Value,
  compare,
  display,
  evaluate,
  isLink,
  truthy,
} from "./values.ts";

/**
 * An Obsidian base (a `.base` file) worked out over a folder's notes: each
 * of its views as a table of the notes its filters keep, with the columns
 * it orders, sorted as it says. Read-only; the file is never written.
 */

export type BaseCell = {
  text: string;
  /** A note the cell links to, as a wiki-link target; null for plain text. */
  link: string | null;
};
export type BaseView = {
  name: string;
  columns: { id: string; label: string }[];
  rows: { path: string; cells: BaseCell[] }[];
};
export type BaseResult = {
  views: BaseView[];
  /** What couldn't be read, such as a filter using a function Anur doesn't have yet. */
  problems: string[];
};

type Filter = string | { and?: Filter[]; or?: Filter[]; not?: Filter[] };
type ViewSpec = {
  type?: string;
  name?: string;
  filters?: Filter;
  order?: string[];
  sort?: { property?: string; direction?: string }[];
  limit?: number;
};
type BaseSpec = {
  filters?: Filter;
  formulas?: Record<string, unknown>;
  properties?: Record<string, { displayName?: string }>;
  views?: ViewSpec[];
};

/** A note's frontmatter properties, or none. */
export function propertiesOf(text: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return {};
  try {
    const value: unknown = parse(m[1] ?? "", { logLevel: "error" });
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readBase(source: string, notes: NoteFacts[]): BaseResult {
  const problems: string[] = [];
  let spec: BaseSpec;
  try {
    spec = (parse(source, { logLevel: "error" }) as BaseSpec | null) ?? {};
  } catch (e) {
    return { views: [], problems: [`The base isn't valid YAML: ${(e as Error).message}`] };
  }
  const parsed = new Map<string, Expr | null>();
  const exprOf = (src: string): Expr | null => {
    if (!parsed.has(src)) {
      try {
        parsed.set(src, parseExpr(src));
      } catch (e) {
        problems.push(`Couldn't read "${src}": ${(e as Error).message}.`);
        parsed.set(src, null);
      }
    }
    return parsed.get(src) ?? null;
  };
  const failed = new Set<string>();
  const run = (src: string, note: NoteFacts, formula: (n: string) => Value): Value | undefined => {
    const e = exprOf(src);
    if (!e) return undefined;
    try {
      return evaluate(e, { note, formula });
    } catch (err) {
      if (!failed.has(src)) problems.push(`Couldn't work out "${src}": ${(err as Error).message}.`);
      failed.add(src);
      return undefined;
    }
  };

  /** Each note's formulas, worked out once, a formula naming itself being null. */
  const formulasFor = (note: NoteFacts) => {
    const done = new Map<string, Value>();
    const busy = new Set<string>();
    const formula = (name: string): Value => {
      if (done.has(name)) return done.get(name) ?? null;
      const src = spec.formulas?.[name];
      if (src === undefined || busy.has(name)) return null;
      busy.add(name);
      const v =
        typeof src === "string" || typeof src === "number"
          ? (run(String(src), note, formula) ?? null)
          : null;
      busy.delete(name);
      done.set(name, v);
      return v;
    };
    return formula;
  };

  // A filter that can't be read keeps every note, and says so in problems.
  const keeps = (
    f: Filter | null | undefined,
    note: NoteFacts,
    formula: (n: string) => Value,
  ): boolean => {
    if (f === undefined || f === null) return true;
    if (typeof f === "string") {
      const v = run(f, note, formula);
      return v === undefined || truthy(v);
    }
    if (f.and && !f.and.every((x) => keeps(x, note, formula))) return false;
    if (f.or && !f.or.some((x) => keeps(x, note, formula))) return false;
    if (f.not?.some((x) => keeps(x, note, formula))) return false;
    return true;
  };

  const valueOf = (id: string, note: NoteFacts, formula: (n: string) => Value): Value => {
    const src =
      id.startsWith("file.") || id.startsWith("formula.") || id.startsWith("note.")
        ? id
        : `note[${JSON.stringify(id)}]`;
    return run(src, note, formula) ?? null;
  };
  const labelOf = (id: string) => {
    const bare = id.replace(/^note\./, "");
    const named = spec.properties?.[id]?.displayName ?? spec.properties?.[bare]?.displayName;
    if (named) return named;
    if (id === "file.name" || id === "file.basename") return "Name";
    return bare.replace(/^(formula|file)\./, "");
  };
  const cellOf = (id: string, note: NoteFacts, v: Value): BaseCell => {
    if (id === "file.name" || id === "file.basename") {
      return { text: display(fileTitle(note.path)), link: note.path.replace(/\.md$/i, "") };
    }
    const first = Array.isArray(v) && v.length === 1 ? v[0] : v;
    return { text: display(v), link: first !== undefined && isLink(first) ? first.link : null };
  };

  const base = notes.map((note) => ({ note, formula: formulasFor(note) }));
  const kept = base.filter(({ note, formula }) => keeps(spec.filters, note, formula));
  const specs = spec.views?.length ? spec.views : [{ type: "table", name: "Table" }];
  const views = specs.map((v, i): BaseView => {
    if (v.type && v.type !== "table")
      problems.push(`The "${v.name ?? ""}" view is a ${v.type}; Anur shows it as a table.`);
    const columns = (v.order?.length ? v.order : ["file.name"]).map(String);
    let rows = kept.filter(({ note, formula }) => keeps(v.filters, note, formula));
    const sorts = (v.sort ?? []).filter((s) => s.property);
    rows = [...rows].sort((a, b) => {
      for (const s of sorts) {
        const id = String(s.property);
        const c = compare(valueOf(id, a.note, a.formula), valueOf(id, b.note, b.formula));
        if (c !== 0) {
          const nothing =
            valueOf(id, a.note, a.formula) === null || valueOf(id, b.note, b.formula) === null;
          // Nothing stays last whichever way the column sorts.
          return String(s.direction).toUpperCase() === "DESC" && !nothing ? -c : c;
        }
      }
      return a.note.path.localeCompare(b.note.path);
    });
    if (typeof v.limit === "number") rows = rows.slice(0, v.limit);
    return {
      name: v.name ?? `View ${String(i + 1)}`,
      columns: columns.map((id) => ({ id, label: labelOf(id) })),
      rows: rows.map(({ note, formula }) => ({
        path: note.path,
        cells: columns.map((id) => cellOf(id, note, valueOf(id, note, formula))),
      })),
    };
  });
  return { views, problems };
}

const fileTitle = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/** A view as a Markdown table, for an agent's context or a copy. */
export function baseAsMarkdown(view: BaseView): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const head = `| ${view.columns.map((c) => cell(c.label)).join(" | ")} |`;
  const rule = `| ${view.columns.map(() => "---").join(" | ")} |`;
  const body = view.rows.map(
    (r) =>
      `| ${r.cells.map((c) => cell(c.link ? `[[${c.link}|${c.text}]]` : c.text)).join(" | ")} |`,
  );
  return [head, rule, ...body].join("\n");
}
