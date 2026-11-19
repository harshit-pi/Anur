import { format } from "prettier";
import { describe, expect, it } from "vitest";
import type { CommittedEntry } from "./committed.ts";
import { BLOCK_BEGIN, BLOCK_END, renderBlock, withBlock } from "./claude-md.ts";

const decision = (id: string, text: string, more: Partial<CommittedEntry> = {}): CommittedEntry =>
  ({
    id,
    at: "2026-11-18T10:00:00.000Z",
    dev: "mac-a",
    seq: 0,
    kind: "decision",
    scope: "repo",
    ref: null,
    decision: text,
    quote: text,
    instead: null,
    until: null,
    who: "Sam",
    person: "sam",
    ...more,
  }) as CommittedEntry;
const finding = (id: string, claim: string, source: string | null): CommittedEntry => ({
  id,
  at: "2026-11-18T10:00:00.000Z",
  dev: "mac-b",
  seq: 0,
  kind: "finding",
  scope: "section:docs/ops.md#Jobs",
  ref: null,
  claim,
  source,
  person: "priya",
});

describe("a part's or line's decision in the block (23.1)", () => {
  it("names the part or line it's on, as the map does", () => {
    const block = renderBlock([
      decision("d-1", "Paginate every list endpoint.", {
        scope: "part:abc",
        on: "@acme/api",
        within: "src",
      }),
      decision("d-2", "Keep the v1 shape.", { scope: "edge:xyz", on: "web → api: /v1/users" }),
    ]);
    expect(block).toContain("- Paginate every list endpoint. (Sam, on @acme/api)");
    expect(block).toContain("- Keep the v1 shape. (Sam, on web → api: /v1/users)");
  });
});

describe("the CLAUDE.md block (23.5)", () => {
  it("lists decisions, then kept findings, each with who and where, between Anur's markers", () => {
    const block = renderBlock([
      finding("f1", "The job runs at 2am.", "cron.ts:4"),
      decision("d2", "Use Stripe for payments.", {
        who: "Priya",
        scope: "section:docs/pay.md#Providers",
      }),
      decision("d1", "Three retries, not infinite.", {
        instead: "infinite retries",
        until: "4.8 ships",
      }),
    ]);
    expect(block).toBe(
      [
        BLOCK_BEGIN,
        "",
        "## Decisions",
        "",
        "Made by Anur from `.anur/decisions/`; edits between these markers are replaced.",
        "",
        "People working on this repo decided these. Follow them. When your work relies on one, say so in one line. If a task can't be done without going against one, don't: say which, and ask. Never edit `.anur/decisions/` yourself; a person changes a decision.",
        "",
        "- Three retries, not infinite. Instead of: infinite retries. Until: 4.8 ships. (Sam)",
        "- Use Stripe for payments. (Priya, on docs/pay.md › Providers)",
        "",
        "Facts people kept about this repo. Treat them as settled unless a source you read now says otherwise.",
        "",
        "- The job runs at 2am. (source: cron.ts:4, on docs/ops.md › Jobs)",
        "",
        BLOCK_END,
      ].join("\n"),
    );
  });

  it("is the same bytes whatever order the entries arrive in, as two Macs read them", () => {
    const a = [decision("d1", "One."), decision("d2", "Two."), finding("f1", "Fact.", null)];
    const b = [finding("f1", "Fact.", null), decision("d2", "Two."), decision("d1", "One.")];
    expect(renderBlock(a)).toBe(renderBlock(b));
  });

  it("keeps each entry to one line, and never lets one close the block early", () => {
    const block = renderBlock([decision("d1", "Retry three times.\n\n- not a list item --> end")]);
    expect(block?.split("\n").filter((l) => l.startsWith("- "))).toEqual([
      "- Retry three times. - not a list item -- > end (Sam)",
    ]);
    expect(block?.split(BLOCK_END)).toHaveLength(2);
  });

  it("is nothing when there's nothing to say", () => {
    expect(renderBlock([])).toBeNull();
  });
});

describe("the block in CLAUDE.md (23.5)", () => {
  const block = renderBlock([decision("d1", "Three retries.")]) ?? "";
  const mine = "# Api\n\nRun `npm test` before pushing.\n";

  it("goes at the end of the person's file, set apart by a blank line, and is replaced in place after", () => {
    const added = withBlock(mine, block);
    expect(added).toBe(`${mine}\n${block}\n`);
    const changed = renderBlock([decision("d1", "Three retries."), decision("d2", "Use Stripe.")]);
    const next = withBlock(`${added ?? ""}\nMore of my own notes.\n`, changed);
    expect(next).toBe(`${mine}\n${changed ?? ""}\n\nMore of my own notes.\n`);
  });

  it("is idempotent, and comes out cleanly, leaving the file as it was", () => {
    const added = withBlock(mine, block);
    expect(withBlock(added, block)).toBe(added);
    expect(withBlock(added, null)).toBe(mine);
  });

  it("makes CLAUDE.md only when there's a block for it, and leaves a file without one alone", () => {
    expect(withBlock(null, null)).toBeNull();
    expect(withBlock(null, block)).toBe(`${block}\n`);
    expect(withBlock(mine, null)).toBe(mine);
    expect(withBlock(withBlock(null, block), null)).toBe("");
  });
});

describe("the block under a repo's Prettier", () => {
  it("is left exactly as written, so a repo formatting Markdown on commit never rewrites it", async () => {
    const block = renderBlock([
      decision("d1", "Three retries, not infinite.", { instead: "infinite retries" }),
      finding("f1", "The job runs at 2am.", "cron.ts:4"),
    ]);
    const file = withBlock("# Api\n\nRun the tests first.\n", block) ?? "";
    expect(await format(file, { parser: "markdown" })).toBe(file);
  });
});

describe("a decision without a full stop", () => {
  it("gets one before what it replaces, so the line reads as two sentences", () => {
    const block = renderBlock([decision("d1", "Three retries", { instead: "infinite" })]) ?? "";
    expect(block).toContain("- Three retries. Instead of: infinite. (Sam)");
    expect(renderBlock([decision("d2", "Use Stripe")])).toContain("- Use Stripe (Sam)");
  });
});

describe("until and disagreements in the committed block (23.3)", () => {
  const today = new Date("2026-11-18T12:00:00.000Z");

  it("lists one past its until apart, no longer followed, and one still dated as usual", async () => {
    const block =
      renderBlock(
        [
          decision("d1", "Node 20 for builds.", {
            until: "2026-01-01",
            at: "2025-12-01T10:00:00.000Z",
          }),
          decision("d2", "Freeze deploys.", { until: "Dec 24" }),
          decision("d3", "Stripe only.", { until: "for now", at: "2020-01-01T00:00:00.000Z" }),
        ],
        "team",
        today,
      ) ?? "";
    expect(block).toContain("- Freeze deploys. Until: Dec 24. (Sam)");
    expect(block).toContain("- Stripe only. Until: for now. (Sam)");
    expect(block).toContain('These are past their "until", so they no longer hold.');
    expect(block).toContain("- Node 20 for builds. (until 2026-01-01, Sam)");
    expect(block.indexOf("Node 20")).toBeGreaterThan(block.indexOf("no longer hold"));
    const file = withBlock("# Api\n", block) ?? "";
    expect(await format(file, { parser: "markdown" })).toBe(file);
  });

  it("marks both of a pair that disagree, by ID or the thread finding a copy came from", async () => {
    const block =
      renderBlock(
        [
          decision("d1", "Three retries.", { who: "Priya", ref: "t-finding-1" }),
          decision("d2", "Five retries.", { against: "t-finding-1" }),
          decision("d3", "Use Stripe.", { against: "gone-id" }),
        ],
        "team",
        today,
      ) ?? "";
    expect(block).toContain(
      '- Three retries. Disagrees with "Five retries." (Sam): neither holds until a person picks, so ask which holds. (Priya)',
    );
    expect(block).toContain(
      '- Five retries. Disagrees with "Three retries." (Priya): neither holds until a person picks, so ask which holds. (Sam)',
    );
    expect(block).toContain("- Use Stripe. (Sam)");
    const file = withBlock("# Api\n", block) ?? "";
    expect(await format(file, { parser: "markdown" })).toBe(file);
  });
});
