import path from "node:path";
import { buildSectionTree } from "@anur/core";
import type { ToolAnswer } from "./anur-socket.ts";

/**
 * One section's own text by its heading, or its path from the title
 * ("Notifications > Retry timing"), with its subsections' headings listed.
 */
export function readSection(
  text: string,
  rel: string,
  wanted: string,
  fromCopy: boolean,
): ToolAnswer {
  const tree = buildSectionTree(text, { fileName: path.basename(rel) });
  const want = wanted
    .split(">")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const matches = tree.sections.filter((s) => {
    const p = s.path.map((x) => x.toLowerCase());
    return want.length <= p.length && want.every((w, i) => p[p.length - want.length + i] === w);
  });
  if (matches.length === 0) {
    const headings = tree.sections.slice(1).map((s) => s.path.slice(1).join(" > "));
    return {
      error: `There's no section "${wanted}" in ${rel}. Its sections: ${headings.join("; ") || "none"}.`,
    };
  }
  if (matches.length > 1)
    return {
      error: `"${wanted}" names more than one section in ${rel}: ${matches.map((s) => s.path.join(" > ")).join("; ")}. Give its path.`,
    };
  const s = matches[0];
  if (!s) return { error: "No section." };
  const own = text.slice(s.ownRange.from, s.ownRange.to).trimEnd();
  const subs = s.children.map((c) => tree.sections[c]?.path.at(-1) ?? "").filter(Boolean);
  return {
    text: [
      `${s.path.join(" > ")} (in ${rel}${fromCopy ? ", your working copy" : ""})`,
      "",
      own,
      ...(subs.length > 0 ? ["", `Its subsections, not included: ${subs.join("; ")}.`] : []),
    ].join("\n"),
  };
}
