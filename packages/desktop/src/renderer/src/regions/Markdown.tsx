/**
 * Markdown as Think and the map show it: tables, lists, quotes and callouts, from an agent's reply or a section's text.
 */
import { type SectionNode } from "@anur/core";
import { inlineRuns } from "../layout/inline-markdown.ts";

/** A section's own text, without its heading line. */
export function bodyOf(text: string, s: SectionNode): string {
  const from = s.headingRange ? s.headingRange.to : s.ownRange.from;
  return text.slice(from, s.ownRange.to).trim();
}

/** A table row's cells; `\\|`, as in a wiki link's alias, stays in its cell. */
export function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

export const DELIMITER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/**
 * Splits a block around its first table: the lines before it, the table's
 * rows, and the lines after. A table is a row of cells, a `---` delimiter
 * row, then rows until a line that isn't one.
 */
export function splitTable(lines: string[]) {
  const at = lines.findIndex(
    (l, i) => l.includes("|") && DELIMITER.test(lines[i + 1] ?? "") && lines[i + 1]?.includes("-"),
  );
  if (at < 0) return null;
  let end = at + 2;
  while (end < lines.length && (lines[end] ?? "").includes("|")) end++;
  return { before: lines.slice(0, at), rows: lines.slice(at, end), after: lines.slice(end) };
}

/** Light Markdown for a reply: paragraphs, bullets, tables and inline styles. */
export const BULLET = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * A block split where its kind changes, as Markdown reads it: a heading is
 * its own block, and a list right after a line of text starts a new one.
 */
export function byKind(block: string): string[] {
  const out: string[][] = [];
  let kind: "heading" | "list" | "text" | "quote" | null = null;
  for (const line of block.split("\n")) {
    const next: "heading" | "list" | "text" | "quote" = /^\s*>/.test(line)
      ? "quote"
      : /^#{1,6}\s/.test(line)
        ? "heading"
        : BULLET.test(line) || (kind === "list" && /^\s+\S/.test(line))
          ? "list"
          : "text";
    if (next !== kind || next === "heading") out.push([]);
    out.at(-1)?.push(line);
    kind = next;
  }
  return out.map((l) => l.join("\n"));
}

/** A callout's colour, as Obsidian groups its types. */
export function calloutTone(type: string): string {
  const t = type.toLowerCase();
  if (["tip", "hint", "important", "success", "check", "done"].includes(t)) return "green";
  if (["warning", "caution", "attention", "question", "help", "faq"].includes(t)) return "amber";
  if (["failure", "fail", "missing", "danger", "error", "bug"].includes(t)) return "red";
  if (["quote", "cite", "example"].includes(t)) return "grey";
  return "blue";
}

/**
 * A quote block: Obsidian's callout when its first line is "[!type] Title",
 * drawn with its title as on the page; otherwise a plain quote.
 */
export function Quote({ block }: { block: string }) {
  const lines = block.split("\n").map((l) => l.replace(/^\s*>\s?/, ""));
  const head = /^\[!([\w-]+)\][+-]?\s*(.*)$/.exec(lines[0] ?? "");
  if (!head) {
    return (
      <blockquote className="md-quote">
        <Markdown text={lines.join("\n")} />
      </blockquote>
    );
  }
  const type = head[1] ?? "note";
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  const title = head[2]?.trim() ?? "";
  const rest = lines.slice(1).join("\n").trim();
  // As the page draws it: the type, then the title, formatted.
  return (
    <div className={`md-callout ${calloutTone(type)}`}>
      <div className="md-callout-title">
        <span className="md-callout-type">{label}</span>
        {title
          ? inlineRuns(title).map((r, j) => (
              <span key={j} className={r.marks.map((m) => `md-${m}`).join(" ") || undefined}>
                {r.text}
              </span>
            ))
          : null}
      </div>
      {rest ? <Markdown text={rest} /> : null}
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  // A table's blank-line-free rows stay one block; anything around it is its own block.
  const blocks = text.split(/\n{2,}/).flatMap((block) => {
    const out: string[] = [];
    let rest = block.split("\n");
    for (let t = splitTable(rest); t; t = splitTable(rest)) {
      if (t.before.length) out.push(t.before.join("\n"));
      out.push(t.rows.join("\n"));
      rest = t.after;
    }
    if (rest.length) out.push(rest.join("\n"));
    return out.flatMap((part) => (splitTable(part.split("\n")) ? [part] : byKind(part)));
  });
  return (
    <>
      {blocks.map((block, b) => {
        const lines = block.split("\n");
        if (/^\s*>/.test(lines[0] ?? "")) return <Quote key={b} block={block} />;
        const bullets = BULLET.test(lines[0] ?? "");
        const render = (line: string, i: number) => (
          <span key={i}>
            {inlineRuns(line).map((r, j) => (
              <span key={j} className={r.marks.map((m) => `md-${m}`).join(" ") || undefined}>
                {r.text}
              </span>
            ))}
          </span>
        );
        const table = splitTable(lines);
        if (table && table.before.length === 0) {
          const [head = "", delimiter = "", ...rows] = table.rows;
          const align = cellsOf(delimiter).map((c) =>
            c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : undefined,
          );
          return (
            <div key={b} className="think-table-wrap">
              <table className="think-table">
                <thead>
                  <tr>
                    {cellsOf(head).map((c, i) => (
                      <th key={i} style={{ textAlign: align[i] }}>
                        {render(c, i)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, j) => (
                    <tr key={j}>
                      {cellsOf(r).map((c, i) => (
                        <td key={i} style={{ textAlign: align[i] }}>
                          {render(c, i)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (bullets)
          return (
            <ul key={b} className="think-list">
              {lines
                .reduce<string[]>((items, l) => {
                  // An indented line under an item continues it.
                  if (BULLET.test(l) || items.length === 0) items.push(l);
                  else if (l.trim()) items.push(`${items.pop() ?? ""} ${l.trim()}`);
                  return items;
                }, [])
                .map((l, i) => (
                  <li key={i}>{render(l, i)}</li>
                ))}
            </ul>
          );
        if (/^#{1,6}\s/.test(block))
          return (
            <p key={b} className="think-heading">
              {render(block, 0)}
            </p>
          );
        return (
          <p key={b}>
            {lines.map((l, i) => (
              <span key={i}>
                {i > 0 ? <br /> : null}
                {render(l, i)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}
