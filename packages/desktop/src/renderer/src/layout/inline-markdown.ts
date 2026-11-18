/**
 * One line of Markdown as styled runs of text, for a search result: the
 * line's heading, list, quote or task marker dropped, and bold, italic,
 * strikethrough, highlight, code and links shown as the page shows them,
 * without their marks.
 */

export type Mark = "bold" | "italic" | "strike" | "highlight" | "code" | "link";
export type Run = { text: string; marks: Mark[] };

const BLOCK = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+(?:\[[ xX]\]\s+)?)/;

/** The patterns, in the order they win when two start at the same place. */
const INLINE: { re: RegExp; mark: Mark | null; inner: (m: RegExpExecArray) => string }[] = [
  { re: /`([^`]+)`/y, mark: "code", inner: (m) => m[1] ?? "" },
  {
    re: /!?\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/y,
    mark: "link",
    inner: (m) => m[3] ?? (m[1] ? (m[1].split("/").pop() ?? m[1]) : (m[2] ?? "")),
  },
  { re: /!?\[([^\]]*)\]\([^)]*\)/y, mark: "link", inner: (m) => m[1] ?? "" },
  { re: /\*\*(?=\S)(.+?)\*\*/y, mark: "bold", inner: (m) => m[1] ?? "" },
  { re: /__(?=\S)(.+?)__(?!\w)/y, mark: "bold", inner: (m) => m[1] ?? "" },
  { re: /~~(?=\S)(.+?)~~/y, mark: "strike", inner: (m) => m[1] ?? "" },
  { re: /==(?=\S)(.+?)==/y, mark: "highlight", inner: (m) => m[1] ?? "" },
  { re: /\*(?=\S)([^*]+?)\*/y, mark: "italic", inner: (m) => m[1] ?? "" },
  { re: /_(?=\S)([^_]+?)_(?!\w)/y, mark: "italic", inner: (m) => m[1] ?? "" },
];

function parse(text: string, marks: Mark[], out: Run[]): void {
  let plain = "";
  const flush = () => {
    if (plain) out.push({ text: plain, marks });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    // "_" opens emphasis only at the start of a word, so snake_case stays as it is.
    const canOpen = !(ch === "_" && /\w/.test(text[i - 1] ?? ""));
    let hit: { mark: Mark | null; inner: string; length: number } | null = null;
    if (canOpen && "`![*_~=".includes(ch)) {
      for (const p of INLINE) {
        p.re.lastIndex = i;
        const m = p.re.exec(text);
        if (m) {
          hit = { mark: p.mark, inner: p.inner(m), length: m[0].length };
          break;
        }
      }
    }
    if (!hit) {
      plain += ch;
      i++;
      continue;
    }
    flush();
    const inner = hit.mark ? [...marks, hit.mark] : marks;
    if (hit.mark === "code") out.push({ text: hit.inner, marks: inner });
    else parse(hit.inner, inner, out);
    i += hit.length;
  }
  flush();
}

export function inlineRuns(line: string): Run[] {
  const out: Run[] = [];
  parse(line.replace(BLOCK, "").trim(), [], out);
  return out;
}

/** Split a run's text where `query` appears, any case, so the matches can be marked. */
export function splitMatches(text: string, query: string): { text: string; match: boolean }[] {
  // Each word typed is marked wherever it appears, as search matches words in any order.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const hit = new Array<boolean>(text.length).fill(false);
  for (const w of words)
    for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + 1))
      for (let j = i; j < i + w.length; j++) hit[j] = true;
  const parts: { text: string; match: boolean }[] = [];
  for (let i = 0; i < text.length;) {
    let j = i;
    while (j < text.length && hit[j] === hit[i]) j++;
    parts.push({ text: text.slice(i, j), match: hit[i] ?? false });
    i = j;
  }
  return parts.length ? parts : [{ text, match: false }];
}
