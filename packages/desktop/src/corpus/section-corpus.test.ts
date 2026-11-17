// The matcher against real edits (task 1.14; Repo and Tooling, "Tests"):
// "Section IDs survive outside edits" and "The same file gives the same
// sections", over every case in corpora/sections/.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SectionId, buildSectionTree, matchSections, sectionBodies } from "@anur/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "corpora",
  "sections",
);

const Case = z.object({
  before: z.string(),
  after: z.string(),
  /** Per new section: the old section's index, null for a new one, -1 when the labels are unsure. */
  labels: z.array(z.int().min(-1).nullable()),
  kinds: z.array(z.enum(["kept", "moved", "renamed", "added", "unknown", "reviewed"])),
});

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();
const cases = files.map((f) => ({
  name: f,
  ...Case.parse(JSON.parse(readFileSync(path.join(DIR, f), "utf8"))),
}));

function run(c: (typeof cases)[number]) {
  const tb = buildSectionTree(c.before, { fileName: "doc.md" });
  const ta = buildSectionTree(c.after, { fileName: "doc.md" });
  const ids = tb.sections.map((_, i) => SectionId.parse(`old${String(i)}`));
  const bodiesB = sectionBodies(c.before, tb);
  const bodiesA = sectionBodies(c.after, ta);
  const result = matchSections(
    tb.sections.map((s, i) => ({
      id: ids[i] ?? SectionId.parse("x"),
      path: s.path,
      body: bodiesB[i] ?? "",
    })),
    ta.sections.map((s, i) => ({ path: s.path, body: bodiesA[i] ?? "" })),
  );
  const got = result.carried.map((id) => (id === null ? null : ids.indexOf(id)));
  return { tb, ta, got };
}

describe("the section corpus", () => {
  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s: no wrong match", (_, c) => {
    const { ta, got } = run(c);
    expect(c.labels).toHaveLength(ta.sections.length);
    const wrong = got.flatMap((g, n) =>
      g !== null && c.labels[n] !== -1 && g !== c.labels[n]
        ? [{ n, got: g, want: c.labels[n] }]
        : [],
    );
    expect(wrong).toEqual([]);
  });

  it.each(cases.map((c) => [c.name, c] as const))(
    "%s: the same file gives the same sections",
    async (name, c) => {
      const shape = (t: ReturnType<typeof buildSectionTree>) =>
        t.sections.map((s) => ({
          path: s.path,
          level: s.level,
          ordinal: s.ordinal,
          own: s.ownRange,
          subtree: s.subtreeRange,
        }));
      const { tb, ta } = run(c);
      await expect(
        `${JSON.stringify({ before: shape(tb), after: shape(ta) }, null, 1)}\n`,
      ).toMatchFileSnapshot(path.join(DIR, "golden", name));
    },
  );

  it("keeps most sections a person would call the same", () => {
    let same = 0;
    let kept = 0;
    for (const c of cases) {
      const { got } = run(c);
      c.labels.forEach((l, n) => {
        if (l === null || l === -1) return;
        same++;
        if (got[n] === l) kept++;
      });
    }
    // Every miss is an orphan with a suggestion, never a wrong match; this
    // floor stops the matcher getting quietly worse.
    expect(kept / same).toBeGreaterThan(0.9);
  });
});
