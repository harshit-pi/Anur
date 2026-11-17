import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Chips for what the page keeps hidden (task 2.14): a callout's type, a code
 * block's language, and an image or embed's path. Each shows as a small chip;
 * a click changes it, through a native menu or a pop-up, and the edit lands
 * in the Markdown as one transaction.
 */

export const CALLOUT_KINDS = [
  "note",
  "abstract",
  "info",
  "todo",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
] as const;

export const LANGUAGES: [string, string][] = [
  ["", "Plain text"],
  ["js", "JavaScript"],
  ["ts", "TypeScript"],
  ["json", "JSON"],
  ["python", "Python"],
  ["bash", "Shell"],
  ["yaml", "YAML"],
  ["md", "Markdown"],
  ["html", "HTML"],
  ["css", "CSS"],
  ["sql", "SQL"],
  ["go", "Go"],
  ["rust", "Rust"],
  ["swift", "Swift"],
];

export const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A language's name for the chip, such as "TypeScript" for "ts". */
export function languageName(info: string): string {
  return LANGUAGES.find(([id]) => id === info.toLowerCase())?.[1] ?? (info || "Plain text");
}

/** Where a callout's kind sits in its first line, which starts at `from` with "[!". */
export function calloutKindRange(state: EditorState, from: number) {
  const m = /^\[!([A-Za-z-]+)\]/.exec(state.sliceDoc(from, state.doc.lineAt(from).to));
  return m?.[1] ? { from: from + 2, to: from + 2 + m[1].length, kind: m[1] } : null;
}

/** Where a code fence's language sits; `from` is the start of its backticks. */
export function fenceInfoRange(state: EditorState, from: number) {
  const m = /^(`{3,}|~{3,})([^\s`]*)/.exec(state.sliceDoc(from, state.doc.lineAt(from).to));
  if (!m?.[1]) return null;
  const start = from + m[1].length;
  return { from: start, to: start + (m[2]?.length ?? 0), info: m[2] ?? "" };
}

/** Where an image's or embed's path sits; `from` is where the element starts. */
export function embedPathRange(state: EditorState, from: number) {
  for (let n = syntaxTree(state).resolveInner(from, 1); n.parent; n = n.parent) {
    if (n.from !== from) continue;
    if (n.name === "Image") {
      const url = n.getChild("URL");
      return url ? { from: url.from, to: url.to } : null;
    }
    if (n.name === "WikiEmbed") {
      const target = n.getChild("WikiLinkTarget");
      const heading = n.getChild("WikiLinkHeading");
      const start = (target ?? heading)?.from;
      const end = (heading ?? target)?.to;
      return start !== undefined && end !== undefined ? { from: start, to: end } : null;
    }
  }
  return null;
}

/** A native menu at the pointer; the bridge loads on use, so this module loads outside a browser. */
export async function chooseFrom(
  items: { id: string; label: string; checked?: boolean }[],
): Promise<string | null> {
  const { anur } = await import("../../bridge.ts");
  const { id } = await anur.call("menu:popup", { items });
  return id;
}

/** Replace a range in the doc as one edit, keeping the cursor where it was. */
export function replace(view: EditorView, from: number, to: number, insert: string) {
  if (view.state.readOnly || view.state.sliceDoc(from, to) === insert) return;
  view.dispatch({ changes: { from, to, insert }, userEvent: "input.chip" });
}
