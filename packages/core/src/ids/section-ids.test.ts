import { describe, expect, it } from "vitest";
import { buildSectionTree } from "../sections/tree.ts";
import { DocId, SectionId } from "../sections/section.ts";
import {
  assignSectionIds,
  buildSectionIdState,
  canonicalId,
  orphanedIds,
  type SectionIdEvent,
  type SectionIdLine,
  type SectionToSave,
} from "./section-ids.ts";

const DOC = DocId.parse("d1");
let n = 0;
/** Turn events into log lines, as a device writes them. */
const lines = (events: readonly SectionIdEvent[], dev = "dev1"): SectionIdLine[] =>
  events.map((e) => ({
    ...e,
    id: `line-${String(++n).padStart(5, "0")}`,
    at: `2026-11-17T01:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}.000Z`,
    dev,
    seq: n,
  }));

const sectionsOf = (doc: string): SectionToSave[] =>
  buildSectionTree(doc, { fileName: "doc.md" }).sections.map((s) => ({
    path: s.path,
    ordinal: s.ordinal,
  }));

/** Save on one device and return the new log. */
function save(log: SectionIdLine[], sections: SectionToSave[], dev = "dev1") {
  const { ids, events } = assignSectionIds(buildSectionIdState(log), DOC, sections);
  return { ids, events, log: [...log, ...lines(events, dev)] };
}

const V1 = "# Title\n\n## Retry timing\n\n### Notes\n\na\n\n### Notes\n\nb\n\n## Channel\n";

describe("minting at save", () => {
  it("mints once, the same IDs on every device, and reuses them after", () => {
    const first = save([], sectionsOf(V1));
    expect(first.events.map((e) => e.kind)).toEqual(["mint", "mint", "mint", "mint", "mint"]);
    expect(save([], sectionsOf(V1), "dev2").ids).toEqual(first.ids);
    const again = save(first.log, sectionsOf(V1));
    expect(again.ids).toEqual(first.ids);
    expect(again.events).toEqual([]);
  });

  it("tells two same-named headings apart by ordinal", () => {
    const { ids } = save([], sectionsOf(V1));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("renames inside Anur", () => {
  it("keep the ID the editor carried, writing one rename line", () => {
    const first = save([], sectionsOf(V1));
    const renamed = sectionsOf(V1.replace("## Retry timing", "## Retry schedule")).map((s, i) => ({
      ...s,
      carried: first.ids[i] ?? null,
    }));
    const second = save(first.log, renamed);
    expect(second.ids).toEqual(first.ids);
    expect(second.events).toEqual([
      {
        kind: "rename",
        section: first.ids[1],
        from: ["Title", "Retry timing"],
        to: ["Title", "Retry schedule"],
      },
      {
        kind: "rename",
        section: first.ids[2],
        from: ["Title", "Retry timing", "Notes"],
        to: ["Title", "Retry schedule", "Notes"],
      },
      {
        kind: "rename",
        section: first.ids[3],
        from: ["Title", "Retry timing", "Notes"],
        to: ["Title", "Retry schedule", "Notes"],
      },
    ]);
    expect(
      save(second.log, sectionsOf(V1.replace("## Retry timing", "## Retry schedule"))).ids,
    ).toEqual(first.ids);
  });
});

describe("deleted headings", () => {
  it("orphan the ID, and a heading written again gets a fresh one", () => {
    const first = save([], sectionsOf(V1));
    const without = V1.replace("## Channel\n", "");
    const second = save(first.log, sectionsOf(without));
    expect(second.events).toEqual([
      { kind: "orphaned", section: first.ids[4], path: ["Title", "Channel"] },
    ]);

    const third = save(second.log, sectionsOf(V1));
    expect(third.ids[4]).not.toBe(first.ids[4]);
    expect(orphanedIds(buildSectionIdState(third.log)).map((r) => r.id)).toEqual([first.ids[4]]);
  });

  it("join the section a person reattaches them to", () => {
    const first = save([], sectionsOf(V1));
    const second = save(first.log, sectionsOf(V1.replace("## Channel\n", "")));
    const third = save(second.log, sectionsOf(V1));
    const orphan = first.ids[4];
    const onto = third.ids[4];
    if (!orphan || !onto) throw new Error("missing IDs");
    const log = [
      ...third.log,
      ...lines([{ kind: "reattach", section: orphan, onto, path: ["Title", "Channel"] }]),
    ];
    const state = buildSectionIdState(log);
    expect(canonicalId(state, orphan)).toBe(onto);
    expect(orphanedIds(state)).toEqual([]);
  });
});

describe("two devices", () => {
  it("join two IDs minted for one heading, the earliest first", () => {
    const sections = sectionsOf("# T\n\n## A\n");
    const a = save([], sections, "devA");
    // devB minted a different ID for the same heading, say because it saw a different log then.
    const otherId = SectionId.parse("b0b0b0b0b0b0b0b0");
    const fromB = lines([{ kind: "mint", section: otherId, path: ["T", "A"], ordinal: 0 }], "devB");
    const merged = save([...a.log, ...fromB], sections);
    expect(merged.ids).toEqual(a.ids);
    expect(merged.events).toEqual([
      { kind: "alias", section: otherId, to: a.ids[1], path: ["T", "A"] },
    ]);
    expect(canonicalId(buildSectionIdState(merged.log), otherId)).toBe(a.ids[1]);
  });
});
