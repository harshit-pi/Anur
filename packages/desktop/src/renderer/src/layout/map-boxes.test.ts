import { buildSectionTree } from "@anur/core";
import { describe, expect, it } from "vitest";
import type { ThreadView } from "../../../shared/ipc-contract.ts";
import { type MapInput, mapBoxes } from "./map-boxes.ts";

const PLAN = `# Launch Plan

We launch Tally to our beta list in March.

## Audience

Flatmates who split rent.

## Pricing

Free for up to 3 people.

## Risks

- Splitwise is free.
`;
const tree = buildSectionTree(PLAN, { fileName: "Launch Plan.md" });
const idOf = (index: number) => `s${String(index)}`;
const pricing = idOf(tree.sections.findIndex((s) => s.path.at(-1) === "Pricing"));

type Item = ThreadView["items"][number];
const thread = (id: string, path: string[], items: Item[]): ThreadView => ({
  id,
  section: "s",
  path,
  title: `Thread ${id}`,
  closed: false,
  busy: false,
  reads: [],
  items,
  options: [],
  tokens: null,
  purpose: null,
  agent: "claude-code",
});
const options = (ids: string[], extra: Partial<Extract<Item, { kind: "options" }>> = {}): Item => ({
  kind: "options",
  turn: "1",
  options: ids.map((id) => ({ id, title: `Option ${id}`, text: `About ${id}` })),
  used: null,
  explored: [],
  within: null,
  heading: null,
  several: false,
  added: [],
  skipped: [],
  ...extra,
});
const PRICING = ["Launch Plan", "Pricing"];

const boxes = (over: Partial<MapInput> = {}) =>
  mapBoxes({
    tree,
    threads: [],
    previews: [],
    idOf,
    docs: [],
    docPath: "Launch Plan.md",
    links: false,
    unfolded: new Set(),
    laneOpen: new Set(),
    writable: true,
    docText: () => PLAN,
    sidesKept: new Map(),
    moved: {},
    drag: null,
    keepSides: () => undefined,
    ...over,
  });
const ids = (bs: { id: string }[]) => bs.map((b) => b.id).sort();

describe("the doc map's boxes", () => {
  it("draws one box per section, the title in the middle", () => {
    const bs = boxes();
    expect(bs.every((b) => b.kind === "section")).toBe(true);
    expect(bs).toHaveLength(tree.sections.length);
    expect(bs.find((b) => b.parent === null)?.side).toBe(0);
    expect(bs.filter((b) => b.parent !== null).every((b) => b.side !== 0)).toBe(true);
  });

  it("hangs a thread's open options off its label on their section", () => {
    const bs = boxes({ threads: [thread("a", PRICING, [options(["x", "y", "z"])])] });
    expect(bs.find((b) => b.id === "t:a")?.kind).toBe("thread");
    const opts = bs.filter((b) => b.kind === "option");
    expect(ids(opts)).toEqual(["o:x", "o:y", "o:z"]);
    expect(opts.every((o) => o.parent === "t:a")).toBe(true);
    expect(bs.find((b) => b.id === "t:a")?.parent).toBe(pricing);
  });

  it("folds the options passed over once one is used, and opens the fold on request", () => {
    // x used, w added beside it: both are in the doc, so only y and z fold.
    const used = thread("a", PRICING, [options(["w", "x", "y", "z"], { used: "x", added: ["w"] })]);
    const folded = boxes({ threads: [used] });
    const fold = folded.find((b) => b.fold);
    expect(fold?.heading).toBe("2 not picked");
    expect(folded.some((b) => b.id === "o:w" || b.id === "o:x")).toBe(false);
    expect(folded.some((b) => b.id === "o:y")).toBe(false);
    const open = boxes({ threads: [used], unfolded: new Set([fold?.id ?? ""]) });
    const shown = open.filter((b) => b.notPicked);
    expect(ids(shown)).toEqual(["o:y", "o:z"]);
  });

  it("shows parts not yet added, and folds the skipped ones", () => {
    const parts = thread("a", PRICING, [
      options(["p", "q", "r"], { several: true, added: ["p"], skipped: ["q"] }),
    ]);
    const bs = boxes({ threads: [parts] });
    expect(ids(bs.filter((b) => b.several))).toEqual(["o:r"]);
    expect(bs.find((b) => b.fold)?.heading).toBe("1 skipped");
  });

  it("counts a thread with nothing drawn off it on its section instead", () => {
    const bs = boxes({ threads: [thread("a", PRICING, [])] });
    expect(bs.some((b) => b.id === "t:a")).toBe(false);
    expect(bs.find((b) => b.id === pricing)?.chats?.map((t) => t.id)).toEqual(["a"]);
  });

  it("puts planned work in the section's lane, folded when there's more than one", () => {
    const planned = (id: string): Item => ({
      kind: "proposed-action",
      id,
      title: `Do ${id}`,
      what: id,
      path: null,
      run: null,
    });
    const bs = boxes({ threads: [thread("a", PRICING, [planned("one"), planned("two")])] });
    const section = bs.find((b) => b.id === pricing);
    expect(section?.lane).toHaveLength(1);
    expect(section?.lane?.[0]).toMatchObject({ kind: "group", state: "planned", count: 2 });
    expect(section?.laneH).toBeGreaterThan(0);
  });

  it("puts a moved section where it was put, its choices moving with it", () => {
    const threads = [thread("a", PRICING, [options(["x"])])];
    const before = boxes({ threads });
    const was = before.find((b) => b.id === pricing);
    const opt = before.find((b) => b.id === "o:x");
    const after = boxes({ threads, moved: { [pricing]: { x: 900, y: 40 } } });
    const now = after.find((b) => b.id === pricing);
    expect(now).toMatchObject({ x: 900, y: 40, shifted: true });
    const moved = after.find((b) => b.id === "o:x");
    expect(moved?.x).toBeCloseTo((opt?.x ?? 0) + 900 - (was?.x ?? 0));
    expect(moved?.y).toBeCloseTo((opt?.y ?? 0) + 40 - (was?.y ?? 0));
  });

  it("hands back each branch's side, so the next layout keeps it", () => {
    let kept: Map<string, -1 | 1> | null = null;
    boxes({
      keepSides: (s) => {
        kept = s;
      },
    });
    expect(kept).not.toBeNull();
  });
});
