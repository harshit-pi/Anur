import { applyEol, detectEol, normalizeEol, type Eol } from "@anur/core";
import { writeFileAtomic } from "./anur-folder.ts";
import { readDocBytes, type ReadDeps } from "./icloud.ts";

/**
 * A doc as Anur holds it (Data Model, "Text edge cases"): its text with "\n"
 * endings, and what it takes to write it back the way the file was.
 *
 * - Windows or old Mac endings come back on write; a file that mixes them is
 *   written with its most common one, and the note says so once.
 * - A byte-order mark comes back on write.
 * - A file that isn't UTF-8 opens read-only, so Anur can't damage it.
 * - A file over 5 MB opens as plain text, without threads or a map.
 */
export const PLAIN_TEXT_BYTES = 5 * 1024 * 1024;

export type DocMode = "editable" | "read-only" | "plain-text";

export type DocFile = {
  text: string;
  eol: Eol;
  bom: boolean;
  mode: DocMode;
  /** Something the person should be told once, such as mixed line endings. */
  note: string | null;
  bytes: number;
};

const UTF8_BOM = [0xef, 0xbb, 0xbf];

function utf16Bom(b: Uint8Array): boolean {
  return (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff);
}

export function decodeDoc(bytes: Uint8Array): DocFile {
  const bom = UTF8_BOM.every((v, i) => bytes[i] === v);
  const body = bom ? bytes.subarray(3) : bytes;
  let raw: string;
  let utf8 = true;
  try {
    if (utf16Bom(bytes)) throw new Error("UTF-16");
    raw = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    utf8 = false;
    // Shown, never saved: undecodable bytes appear as replacement characters.
    raw = new TextDecoder("utf-8").decode(body);
  }
  const report = detectEol(raw);
  const text = normalizeEol(raw);
  const base = { text, eol: report.eol, bom, bytes: bytes.length };

  if (!utf8) {
    return {
      ...base,
      mode: "read-only",
      note: "This file isn't UTF-8, so Anur opens it read-only rather than risk changing its bytes.",
    };
  }
  if (bytes.length > PLAIN_TEXT_BYTES) {
    return {
      ...base,
      mode: "plain-text",
      note: "This file is over 5 MB, so Anur opens it as plain text, without threads or a map.",
    };
  }
  const ending =
    report.eol === "\r\n" ? "Windows (CRLF)" : report.eol === "\r" ? "old Mac (CR)" : "Unix (LF)";
  return {
    ...base,
    mode: "editable",
    note: report.mixed
      ? `This file mixes line endings; Anur will save it with ${ending} endings, its most common.`
      : null,
  };
}

export function encodeDoc(text: string, doc: Pick<DocFile, "eol" | "bom">): Uint8Array {
  const body = new TextEncoder().encode(applyEol(text, doc.eol));
  if (!doc.bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set(UTF8_BOM, 0);
  out.set(body, 3);
  return out;
}

export async function readDoc(file: string, deps?: ReadDeps): Promise<DocFile> {
  return decodeDoc(await readDocBytes(file, deps));
}

/** Write a doc's text back the way the file was; refuses a doc opened read-only or as plain text. */
export async function writeDoc(file: string, text: string, doc: DocFile): Promise<void> {
  if (doc.mode !== "editable") throw new Error(`${file} is ${doc.mode}; Anur doesn't write it`);
  await writeFileAtomic(file, encodeDoc(text, doc));
}
