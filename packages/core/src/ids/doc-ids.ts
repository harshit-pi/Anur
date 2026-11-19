import { z } from "zod";
import { LineEnvelope } from "../jsonl/lines.ts";
import { DocId } from "../sections/section.ts";
import { mintId } from "./mint.ts";

/**
 * Doc IDs (task 1.11): a hash of the doc's path when Anur first sees it,
 * followed when Anur renames or moves the doc. A new file at an old doc's
 * path gets its own ID, because the old one is taken.
 *
 * Doc events go in the doc's own ID log, `docs/<doc>/ids/<device>.jsonl`,
 * beside its section events (task 1.12), so every device can rebuild the
 * map from paths to docs by reading the logs.
 */

/** A path relative to the opened folder, with forward slashes, in Unicode NFC. */
export function normalizeDocPath(p: string): string {
  const norm = p
    .normalize("NFC")
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "");
  if (norm === "" || norm.startsWith("/") || /^[A-Za-z]:/.test(norm)) {
    throw new Error(`a doc path is relative to the folder: ${JSON.stringify(p)}`);
  }
  if (norm.split("/").some((s) => s === ".." || s === "." || s === "")) {
    throw new Error(`a doc path stays inside the folder: ${JSON.stringify(p)}`);
  }
  return norm;
}

const DocPath = z.string().transform((p, ctx) => {
  try {
    return normalizeDocPath(p);
  } catch (e) {
    ctx.addIssue({ code: "custom", message: (e as Error).message });
    return z.NEVER;
  }
});

export const DocMintLine = LineEnvelope.extend({
  kind: z.literal("doc-mint"),
  doc: DocId,
  path: DocPath,
});
export const DocMoveLine = LineEnvelope.extend({
  kind: z.literal("doc-move"),
  doc: DocId,
  from: DocPath,
  to: DocPath,
});
export const DocOrphanedLine = LineEnvelope.extend({
  kind: z.literal("doc-orphaned"),
  doc: DocId,
  path: DocPath,
});
export const DocIdLine = z.discriminatedUnion("kind", [DocMintLine, DocMoveLine, DocOrphanedLine]);
export type DocIdLine = z.infer<typeof DocIdLine>;

export type DocRegistry = {
  /** Live docs by their current path. */
  byPath: Map<string, DocId>;
  /** Every doc ever minted, live or orphaned, with its latest path. */
  byId: Map<DocId, { path: string; orphaned: boolean }>;
};

/**
 * The map from paths to docs, from every device's doc events in merged order.
 * If two devices minted different IDs for one path, the earlier mint holds it.
 */
export function buildDocRegistry(lines: readonly DocIdLine[]): DocRegistry {
  const byPath = new Map<string, DocId>();
  const byId = new Map<DocId, { path: string; orphaned: boolean }>();
  for (const l of lines) {
    if (l.kind === "doc-mint") {
      byId.set(l.doc, { path: l.path, orphaned: false });
      if (!byPath.has(l.path)) byPath.set(l.path, l.doc);
    } else if (l.kind === "doc-move") {
      byId.set(l.doc, { path: l.to, orphaned: false });
      if (byPath.get(l.from) === l.doc) byPath.delete(l.from);
      byPath.set(l.to, l.doc);
    } else {
      byId.set(l.doc, { path: l.path, orphaned: true });
      if (byPath.get(l.path) === l.doc) byPath.delete(l.path);
    }
  }
  return { byPath, byId };
}

/** The doc at a path: its existing ID, or a new one minted by the rule. */
export function docIdFor(
  registry: DocRegistry,
  path: string,
  /**
   * The home's own ID (18.15.2): two homes with a doc at the same path, such
   * as two repos' README.md, mint different IDs. Docs already known keep theirs.
   */
  salt: string | null = null,
): { doc: DocId; isNew: boolean } {
  const norm = normalizeDocPath(path);
  const live = registry.byPath.get(norm);
  if (live) return { doc: live, isNew: false };
  const id = mintId(salt ? ["doc", salt, norm] : ["doc", norm], (candidate) =>
    registry.byId.has(candidate as DocId),
  );
  return { doc: DocId.parse(id), isNew: true };
}
