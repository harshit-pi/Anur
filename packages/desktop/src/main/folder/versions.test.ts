import { mkdtempSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SectionVersions } from "./versions.ts";

const DOC = "# Plan\n\nWe ship Monday.\n\n## Risks\n\nThe host is untested.\n";

/** Every version written in the folder, as [heading path, cause, text]. */
async function versionsIn(folder: string): Promise<[string, string, string][]> {
  const out: [string, string, string][] = [];
  const docs = path.join(folder, ".anur", "docs");
  for (const doc of await readdir(docs)) {
    const history = path.join(docs, doc, "history");
    const sections = await readdir(history).catch(() => [] as string[]);
    for (const s of sections) {
      for (const f of await readdir(path.join(history, s))) {
        for (const line of (await readFile(path.join(history, s, f), "utf8")).trim().split("\n")) {
          const v = JSON.parse(line) as {
            path: string[];
            cause: string;
            text: string;
            seq: number;
          };
          out.push([v.path.join(" > "), v.cause, v.text.trim()]);
        }
      }
    }
  }
  return out.sort((a, b) => a.join().localeCompare(b.join()));
}

const folder = () => mkdtempSync(path.join(tmpdir(), "anur-versions-"));

describe("section versions", () => {
  it("store a starting version of each section the first time a doc opens, and only then", async () => {
    const f = folder();
    const v = new SectionVersions(f, "dev1", (e) => {
      throw e;
    });
    await v.opened("Plan.md", DOC);
    await v.opened("Plan.md", DOC);
    const all = await versionsIn(f);
    expect(all.map(([p, c]) => `${p}:${c}`)).toEqual(["Plan > Risks:start", "Plan:start"]);
  });

  it("store a version of each section an outside change touched, and no other", async () => {
    const f = folder();
    const v = new SectionVersions(f, "dev1");
    await v.opened("Plan.md", DOC);
    await v.outside("Plan.md", DOC.replace("untested", "soak-tested"));
    const outside = (await versionsIn(f)).filter(([, c]) => c === "outside");
    expect(outside).toEqual([["Plan > Risks", "outside", "## Risks\n\nThe host is soak-tested."]]);
  });

  it("keep typing saved since, before the outside change replaces it", async () => {
    const f = folder();
    const v = new SectionVersions(f, "dev1");
    await v.opened("Plan.md", DOC);
    const typed = DOC.replace("untested", "untested on Linux");
    await v.saved("Plan.md", typed);
    await v.outside("Plan.md", DOC.replace("untested", "fine"));
    const risks = (await versionsIn(f))
      .filter(([p]) => p === "Plan > Risks")
      .map(([, c, t]) => `${c}:${t.split("\n").at(-1) ?? ""}`);
    expect(risks).toContain("typing:The host is untested on Linux.");
    expect(risks).toContain("outside:The host is fine.");
  });

  it("follow a heading renamed in Anur, so its history stays one", async () => {
    const f = folder();
    const v = new SectionVersions(f, "dev1");
    await v.opened("Plan.md", DOC);
    const renamed = DOC.replace("## Risks", "## Open risks");
    await v.saved("Plan.md", renamed);
    await v.outside("Plan.md", renamed.replace("untested", "fine"));
    const docs = path.join(f, ".anur", "docs");
    const [doc] = await readdir(docs);
    // Two sections, two history folders: the rename kept the ID.
    expect(await readdir(path.join(docs, doc ?? "", "history"))).toHaveLength(2);
  });

  it("record nothing while the file holds merge-conflict markers", async () => {
    const f = folder();
    const v = new SectionVersions(f, "dev1");
    await v.opened("Plan.md", `${DOC}\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> theirs\n`);
    expect(await versionsIn(f)).toEqual([]);
  });
});
