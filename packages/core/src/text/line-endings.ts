/**
 * Line endings (Data Model, "Text edge cases"). Inside Anur every doc uses
 * "\n", which is what the editor and the parser expect; on write the file
 * gets its own ending back. A file that mixes endings is written with its
 * most common one, and Anur says so once.
 */
export type Eol = "\n" | "\r\n" | "\r";

export type EolReport = {
  /** The ending the file is written back with. */
  eol: Eol;
  /** True when the file used more than one kind of ending. */
  mixed: boolean;
  counts: Record<"lf" | "crlf" | "cr", number>;
};

export function detectEol(text: string): EolReport {
  const counts = { lf: 0, crlf: 0, cr: 0 };
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        counts.crlf++;
        i++;
      } else counts.cr++;
    } else if (c === 10) counts.lf++;
  }
  const kinds = [counts.lf, counts.crlf, counts.cr].filter((n) => n > 0).length;
  // The most common wins; a tie, or no line breaks at all, keeps "\n".
  let eol: Eol = "\n";
  if (counts.crlf > counts.lf && counts.crlf >= counts.cr) eol = "\r\n";
  else if (counts.cr > counts.lf && counts.cr > counts.crlf) eol = "\r";
  return { eol, mixed: kinds > 1, counts };
}

/** Every ending as "\n", for the editor and the parser. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Text with "\n" endings, written with the file's own ending. */
export function applyEol(text: string, eol: Eol): string {
  return eol === "\n" ? text : text.replace(/\n/g, eol);
}
