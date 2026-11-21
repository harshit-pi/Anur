import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LinkIndex } from "./link-index.ts";

async function folder(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), "anur-links-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), text);
  }
  return dir;
}

const PLAN = `# Plan

## Pricing

See [[Pricing#Plans]] and [[spec]]. Also [[Nowhere]].

## Risks

Nothing.
`;
const PRICING = `# Pricing

## Plans

Paid: £4.

## Notes

Back to [[Plan#Pricing]].
`;

describe("LinkIndex", () => {
  it("resolves a section's links out across the folder, and marks a broken one", async () => {
    const dir = await folder({
      "Plan.md": PLAN,
      "docs/Pricing.md": PRICING,
      "specs/spec.md": "# Spec\n",
    });
    const index = new LinkIndex(dir);
    const out = await index.linksOut("Plan.md", ["Plan", "Pricing"]);
    expect(out.map((l) => [l.doc, l.heading])).toEqual([
      ["docs/Pricing.md", "Plans"],
      ["specs/spec.md", null],
      [null, null],
    ]);
    expect(out[2]?.written).toBe("Nowhere");
    expect(await index.linksOut("Plan.md", ["Plan", "Risks"])).toEqual([]);
    // Only a section's own text: the title doesn't gather its sections' links.
    expect(await index.linksOut("Plan.md", ["Plan"])).toEqual([]);
  });

  it("finds the sections that link in, by heading or to the whole doc", async () => {
    const dir = await folder({
      "Plan.md": PLAN,
      "docs/Pricing.md": PRICING,
      "specs/spec.md": "# Spec\n",
    });
    const index = new LinkIndex(dir);
    const into = await index.linksIn("docs/Pricing.md", ["Pricing", "Plans"]);
    expect(into.map((l) => l.from)).toEqual([{ doc: "Plan.md", path: ["Plan", "Pricing"] }]);
    const toSpec = await index.linksIn("specs/spec.md", ["Spec"]);
    expect(toSpec.map((l) => l.from.doc)).toEqual(["Plan.md"]);
    const back = await index.linksIn("Plan.md", ["Plan", "Pricing"]);
    expect(back.map((l) => l.from)).toEqual([
      { doc: "docs/Pricing.md", path: ["Pricing", "Notes"] },
    ]);
  });

  it("uses the open doc's text when given, so links being typed count", async () => {
    const dir = await folder({ "Plan.md": PLAN, "docs/Pricing.md": PRICING });
    const index = new LinkIndex(dir);
    const typed = PLAN.replace("Nothing.", "See [[Pricing]].");
    const out = await index.linksOut("Plan.md", ["Plan", "Risks"], typed);
    expect(out.map((l) => l.doc)).toEqual(["docs/Pricing.md"]);
  });

  it("lets other calls in between docs while a first scan parses the folder", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 120; i++) files[`d${String(i)}.md`] = PLAN;
    const index = new LinkIndex(await folder(files));
    // Most docs parsed with no turn of the event loop between them.
    let run = 0;
    let most = 0;
    type Parse = { parse: (rel: string, text: string) => unknown };
    const real = (index as unknown as Parse).parse.bind(index);
    const parse = vi.spyOn(index as unknown as Parse, "parse").mockImplementation((rel, text) => {
      most = Math.max(most, ++run);
      return real(rel, text);
    });
    let done = false;
    const tick = () => {
      run = 0;
      if (!done) setImmediate(tick);
    };
    setImmediate(tick);
    await index.allDocs();
    done = true;
    expect(parse).toHaveBeenCalledTimes(120);
    expect(most).toBe(1);
  });
});
