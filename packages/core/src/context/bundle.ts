import { formatPath, type Range } from "../sections/section.ts";
import type { SectionTree } from "../sections/tree.ts";

/**
 * A thread's section bundle (task 3.4; Data Model, "What a person sees and
 * what an agent gets"): the Markdown a thread's first turn starts from.
 *
 * Which parts go in is decided by `BUNDLE_RULES`, held as data, so a variant
 * of the rules is a change to that list, not to this code. The same parts
 * drive the thread's reads line, so what is shown is exactly what is sent.
 */

/** One part of the bundle, as the reads line lists it. */
export type BundlePart = {
  kind: "ancestor" | "section" | "siblings";
  /** What the reads line says it is: the section's heading, or "Sibling sections". */
  label: string;
  /** How much of it: "its text", "its outline". */
  detail: string;
  text: string;
};

export type Bundle = { markdown: string; parts: BundlePart[] };

export type BundleRule =
  /** The own text of each section from the title down to the parent: not their subtrees. */
  | "ancestors-own-text"
  /** The section's whole subtree. */
  | "section-subtree"
  /** Each sibling's heading and first line. */
  | "siblings-outline";

/** The rules for a thread on one section, in the order their parts are sent. */
export const BUNDLE_RULES: readonly BundleRule[] = [
  "ancestors-own-text",
  "section-subtree",
  "siblings-outline",
];

export type BundleInput = {
  /** The doc's text, and its section tree built from that text. */
  text: string;
  tree: SectionTree;
  /** The section the thread is on, by index in the tree. */
  index: number;
  /** The doc's path in the folder, for the header. */
  docPath: string;
  rules?: readonly BundleRule[];
};

const slice = (text: string, r: Range) => text.slice(r.from, r.to).trim();

/** A section's own text with its heading line taken off: the heading path already names it. */
function bodyOf(text: string, tree: SectionTree, i: number): string {
  const s = tree.sections[i];
  if (!s) return "";
  const from = s.headingRange ? s.headingRange.to : s.ownRange.from;
  return text.slice(from, s.ownRange.to).trim();
}

/** The first non-blank line of a section's body, without list or quote marks. */
function firstLine(text: string, tree: SectionTree, i: number): string {
  const line = bodyOf(text, tree, i)
    .split("\n")
    .find((l) => l.trim() !== "");
  return (line ?? "")
    .replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/, "")
    .trim()
    .slice(0, 200);
}

export function buildBundle({
  text,
  tree,
  index,
  docPath,
  rules = BUNDLE_RULES,
}: BundleInput): Bundle {
  const section = tree.sections[index];
  if (!section) throw new Error(`no section at index ${String(index)}`);
  const parts: BundlePart[] = [];

  const ancestors: number[] = [];
  for (let p = section.parent; p !== null; p = tree.sections[p]?.parent ?? null)
    ancestors.unshift(p);

  for (const rule of rules) {
    if (rule === "ancestors-own-text") {
      for (const a of ancestors) {
        const node = tree.sections[a];
        if (!node) continue;
        parts.push({
          kind: "ancestor",
          label: node.path.at(-1) ?? "",
          detail: a === section.parent ? "parent, its text" : "above, its text",
          text: bodyOf(text, tree, a),
        });
      }
    } else if (rule === "section-subtree") {
      parts.push({
        kind: "section",
        label: section.path.at(-1) ?? "",
        detail: "this section, its text",
        text: slice(text, section.subtreeRange),
      });
    } else if (section.parent !== null) {
      const siblings = (tree.sections[section.parent]?.children ?? []).filter((c) => c !== index);
      if (siblings.length > 0) {
        parts.push({
          kind: "siblings",
          label: "Sibling sections",
          detail: "their outline",
          text: siblings
            .map((c) => {
              const node = tree.sections[c];
              const first = firstLine(text, tree, c);
              return `- ${node?.path.at(-1) ?? ""}${first ? `: ${first}` : ""}`;
            })
            .join("\n"),
        });
      }
    }
  }

  const where = formatPath(section.path);
  const lines = [
    `# Anur: a thread on one section`,
    "",
    `This thread is about one section of the doc \`${docPath}\`: **${where}**.`,
    "Below is what this thread works from: the text of the sections above it, this section in full, and an outline of the sections beside it. Other sections' full text and other threads are not included, on purpose, so this discussion stays about this section.",
    "",
  ];
  for (const part of parts) {
    if (part.kind === "ancestor") {
      lines.push(`## Above it: ${part.label}`, "", part.text || "(no text of its own)", "");
    } else if (part.kind === "section") {
      lines.push(`## This section: ${where}`, "", part.text || "(empty)", "");
    } else {
      lines.push("## Sections beside it, as an outline", "", part.text, "");
    }
  }
  return { markdown: `${lines.join("\n").trimEnd()}\n`, parts };
}
