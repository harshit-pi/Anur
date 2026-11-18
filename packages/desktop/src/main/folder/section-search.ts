import path from "node:path";
import { buildSectionTree } from "@anur/core";
import type { FolderState } from "../../shared/ipc-contract.ts";
import { textOf } from "./search.ts";

/**
 * anur_search_sections (12.6): the sections whose own text has every word
 * asked for, across the folder's docs, each with its matching lines. Docs
 * still in iCloud are left out rather than downloaded; nothing outside the
 * folder is read.
 */
export type SectionHit = { doc: string; path: string[]; lines: { line: number; text: string }[] };

const MAX_SECTIONS = 20;
const MAX_LINES = 3;

export async function searchSections(
  folder: Pick<FolderState, "path" | "docs" | "offloaded">,
  query: string,
): Promise<{ hits: SectionHit[]; more: boolean; skipped: number }> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { hits: [], more: false, skipped: 0 };
  const offloaded = new Set(folder.offloaded);
  const hits: SectionHit[] = [];
  for (const doc of folder.docs) {
    if (offloaded.has(doc)) continue;
    const text = await textOf(path.join(folder.path, doc));
    if (text === null) continue;
    const lower = text.toLowerCase();
    if (!words.every((w) => lower.includes(w))) continue;
    const tree = buildSectionTree(text, { fileName: path.basename(doc) });
    for (const s of tree.sections) {
      const own = lower.slice(s.ownRange.from, s.ownRange.to);
      if (!words.every((w) => own.includes(w))) continue;
      if (hits.length >= MAX_SECTIONS) return { hits, more: true, skipped: offloaded.size };
      const first = text.slice(0, s.ownRange.from).split("\n").length;
      const lines = text
        .slice(s.ownRange.from, s.ownRange.to)
        .split("\n")
        .map((t, i) => ({ line: first + i, text: t.trim() }))
        .filter((l) => words.some((w) => l.text.toLowerCase().includes(w)))
        .slice(0, MAX_LINES)
        .map((l) => ({ ...l, text: l.text.length > 160 ? `${l.text.slice(0, 160)}…` : l.text }));
      hits.push({ doc, path: s.path, lines });
    }
  }
  return { hits, more: false, skipped: offloaded.size };
}

/** The hits as the tool's answer: doc and heading path, then each matching line. */
export function sectionHitsText(
  query: string,
  found: { hits: SectionHit[]; more: boolean; skipped: number },
): string {
  if (found.hits.length === 0)
    return `No section has every word of "${query}".${found.skipped ? ` ${String(found.skipped)} docs still in iCloud weren't searched.` : ""}`;
  const out = [
    `${found.more ? `The first ${String(found.hits.length)}` : String(found.hits.length)} section${found.hits.length === 1 ? "" : "s"} with every word of "${query}" (read one with anur_read_section):`,
  ];
  for (const h of found.hits) {
    out.push(`- ${h.doc} > ${h.path.join(" > ")}`);
    for (const l of h.lines) out.push(`  ${String(l.line)}: ${l.text}`);
  }
  if (found.skipped) out.push(`${String(found.skipped)} docs still in iCloud weren't searched.`);
  return out.join("\n");
}
