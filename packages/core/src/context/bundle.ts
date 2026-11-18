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
  kind: "ancestor" | "section" | "siblings" | "outline" | "full";
  /** What the reads line says it is: the section's heading, "Sibling sections" or "The rest of the doc". */
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
  | "siblings-outline"
  /**
   * The whole doc as an outline: every section's heading and first line,
   * where this section sits marked. Its full text, and its inputs, are one
   * call away; decided text is the current doc, never another thread's chat
   * (decided 2026-11-17).
   */
  | "doc-outline"
  /**
   * Every other section in full: its heading and its own text, in the
   * doc's order. Past the budget it falls back to the outline.
   */
  | "doc-full"
  /** The header asks the agent to read any section that could set a rule for its answer. */
  | "fetch-hint";

/**
 * The rules for a thread on one section, in the order their parts are sent:
 * the rest of the doc in full within the budget, else as an outline with a
 * hint to read any section that could set a rule. Chosen after the context
 * eval (decided 2026-11-17): the outline alone lost rules past a section's
 * first line; full text and a fetch hint each kept them every time.
 */
export const BUNDLE_RULES: readonly BundleRule[] = [
  "ancestors-own-text",
  "section-subtree",
  "doc-full",
  "fetch-hint",
];

export type BundleInput = {
  /** The doc's text, and its section tree built from that text. */
  text: string;
  tree: SectionTree;
  /** The section the thread is on, by index in the tree. */
  index: number;
  /** The doc's path in the folder, for the header. */
  docPath: string;
  /** Where this thread's working copy of the doc is; the header tells the agent to edit there. */
  workingCopy?: string | null;
  rules?: readonly BundleRule[];
  /**
   * How many characters "doc-full" may add before it falls back to the
   * outline: about a third of a 200,000-token context window.
   */
  budget?: number;
};

/** About a third of a 200,000-token context window, at roughly four characters a token. */
export const FULL_TEXT_BUDGET = 240_000;

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
  workingCopy = null,
  rules = BUNDLE_RULES,
  budget = FULL_TEXT_BUDGET,
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
    } else if (rule === "fetch-hint") {
      // Only the header changes; see below.
    } else if (rule === "doc-outline" || rule === "doc-full") {
      const own = new Set<number>();
      const mark = (i: number) => {
        own.add(i);
        for (const c of tree.sections[i]?.children ?? []) mark(c);
      };
      mark(index);
      const above = new Set(ancestors);
      const rows = tree.sections.flatMap((node) => {
        // This section's subsections are given in full already.
        if (own.has(node.index) && node.index !== index) return [];
        const indent = "  ".repeat(Math.max(0, node.path.length - 1));
        const name = node.path.at(-1) ?? "";
        if (node.index === index) return [`${indent}- **${name}** (this section, given in full)`];
        if (node.index === 0 && above.has(0))
          return [`- ${name} (the doc's title, its text given)`];
        if (above.has(node.index)) return [`${indent}- ${name} (above it, its text given)`];
        const first = firstLine(text, tree, node.index);
        return [`${indent}- ${name}${first ? `: ${first}` : ""}`];
      });
      // The rest in full, where the rule asks for it and the budget allows.
      const full =
        rule === "doc-full"
          ? tree.sections
              .filter((node) => !own.has(node.index) && !above.has(node.index))
              .map((node) => {
                const heading = `${"#".repeat(Math.min(6, Math.max(1, node.path.length)))} ${node.path.at(-1) ?? ""}`;
                const body = bodyOf(text, tree, node.index);
                return body ? `${heading}\n\n${body}` : heading;
              })
              .join("\n\n")
          : null;
      if (full !== null && full.length <= budget) {
        if (full)
          parts.push({
            kind: "full",
            label: "The rest of the doc",
            detail: "its text",
            text: full,
          });
      } else if (rows.length > 1) {
        parts.push({
          kind: "outline",
          label: "The rest of the doc",
          detail: "its outline",
          text: rows.join("\n"),
        });
      }
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
    parts.some((p) => p.kind === "full")
      ? "Below is what this thread works from: the text of the sections above it, this section in full, and the rest of the doc in full. Other threads' discussions are never included, on purpose, so this one stays about this section."
      : "Below is what this thread works from: the text of the sections above it, this section in full, and the rest of the doc as an outline, each section's heading and first line. Any section's full text is one call away with Anur's anur_read_section tool. Other threads' discussions are never included, on purpose, so this one stays about this section.",
    ...(rules.includes("fetch-hint") && !parts.some((p) => p.kind === "full")
      ? [
          "Before you answer, read with anur_read_section any section in the outline whose text could set a rule for your answer, such as a rule on wording, format or channels; the outline shows first lines only.",
        ]
      : []),
    "",
    "When you have alternatives for this section, two or more ways it could read, offer them with Anur's anur_offer_options tool instead of listing them in your reply: each option is a short title and the section's whole new text, without its heading. The person sees them as cards and on the map, and picks one; its text replaces the section's. Your reply then says in a line or two how they differ; don't repeat their text.",
    "",
  ];
  if (workingCopy) {
    lines.push(
      `Your working copy of \`${docPath}\` is at \`${workingCopy}\`. Use your judgment: answer a question; offer options when there is a real choice; when the person asks for a change, or the change is clear, edit that file with your own tools. Anur shows each edit to them as a proposal on its section, and the doc changes only when they use it, so say your edit is ready for them to use, never that you've updated the doc. The doc in the folder is the decided text. Shell commands such as \`git diff\` see the decided text, not your edits.`,
      "",
    );
  }
  for (const part of parts) {
    if (part.kind === "ancestor") {
      lines.push(`## Above it: ${part.label}`, "", part.text || "(no text of its own)", "");
    } else if (part.kind === "section") {
      lines.push(`## This section: ${where}`, "", part.text || "(empty)", "");
    } else if (part.kind === "outline") {
      lines.push("## The whole doc, as an outline", "", part.text, "");
    } else if (part.kind === "full") {
      lines.push("## The rest of the doc, in full", "", part.text, "");
    } else {
      lines.push("## Sections beside it, as an outline", "", part.text, "");
    }
  }
  return { markdown: `${lines.join("\n").trimEnd()}\n`, parts };
}
