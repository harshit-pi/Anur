import { matchSections, sectionBodies } from "../ids/matcher.ts";
import { SectionId } from "../sections/section.ts";
import { buildSectionTree } from "../sections/tree.ts";

/**
 * Merging a sync conflict copy into its original, one section at a time.
 * Sections are paired with the same matcher that keeps IDs through outside
 * edits, then each pair is the same, differs, or exists on one side only. The
 * person picks per section; the result keeps the original's frontmatter and
 * order, with sections only in the copy placed after the section they
 * followed there.
 */
export type MergePart =
  | { kind: "same"; path: string[]; text: string }
  | { kind: "differs"; path: string[]; original: string; copy: string }
  | { kind: "only-original"; path: string[]; text: string }
  | { kind: "only-copy"; path: string[]; text: string };

export type MergePlan = { prefix: string; parts: MergePart[] };

/** Per part, by index: "original" or "copy" for a difference; include or not for a one-sided part. */
export type MergeChoices = Record<number, "original" | "copy" | boolean>;

export function planConflictMerge(original: string, copy: string): MergePlan {
  const to = buildSectionTree(original, { fileName: "original.md" });
  const tc = buildSectionTree(copy, { fileName: "copy.md" });
  const own = (doc: string, t: typeof to) =>
    t.sections.map((s) => doc.slice(s.ownRange.from, s.ownRange.to));
  const [ownO, ownC] = [own(original, to), own(copy, tc)];
  const [bodyO, bodyC] = [sectionBodies(original, to), sectionBodies(copy, tc)];
  const ids = to.sections.map((_, i) => SectionId.parse(`o${String(i)}`));
  const match = matchSections(
    to.sections.map((s, i) => ({
      id: ids[i] ?? SectionId.parse("o"),
      path: s.path,
      body: bodyO[i] ?? "",
    })),
    tc.sections.map((s, i) => ({ path: s.path, body: bodyC[i] ?? "" })),
  );
  const copyOf = new Map<number, number>();
  match.carried.forEach((id, c) => {
    if (id) copyOf.set(Number(id.slice(1)), c);
  });

  const parts: MergePart[] = [];
  const placed = new Set<number>();
  const placeCopyOnlyAfter = (c: number) => {
    // Sections only in the copy that followed copy section c there, up to the next matched one.
    for (let k = c + 1; k < tc.sections.length && match.carried[k] === null; k++) {
      if (placed.has(k)) continue;
      placed.add(k);
      parts.push({ kind: "only-copy", path: tc.sections[k]?.path ?? [], text: ownC[k] ?? "" });
    }
  };
  // Sections only in the copy before its first matched section go first.
  placeCopyOnlyAfter(-1);
  to.sections.forEach((s, o) => {
    const c = copyOf.get(o);
    const textO = ownO[o] ?? "";
    if (c === undefined) parts.push({ kind: "only-original", path: s.path, text: textO });
    else {
      const textC = ownC[c] ?? "";
      parts.push(
        textO === textC
          ? { kind: "same", path: s.path, text: textO }
          : { kind: "differs", path: s.path, original: textO, copy: textC },
      );
      placeCopyOnlyAfter(c);
    }
  });
  return { prefix: original.slice(0, to.body.from), parts };
}

/** The merged doc. A difference defaults to the original; a one-sided section defaults to kept. */
export function applyMerge(plan: MergePlan, choices: MergeChoices = {}): string {
  let out = plan.prefix;
  const append = (text: string) => {
    if (text === "") return;
    // A section that ended the file with no newline must not run into the next one.
    if (out !== plan.prefix && !out.endsWith("\n")) out += "\n\n";
    out += text;
  };
  plan.parts.forEach((p, i) => {
    const choice = choices[i];
    switch (p.kind) {
      case "same":
        append(p.text);
        break;
      case "differs":
        append(choice === "copy" ? p.copy : p.original);
        break;
      case "only-original":
      case "only-copy":
        if (choice !== false) append(p.text);
        break;
    }
  });
  return out;
}
