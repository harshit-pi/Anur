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

  it("store sections changed while the doc was closed as outside versions", async () => {
    const f = folder();
    const saved = new Map<string, string>();
    const memory = {
      read: (rel: string) => Promise.resolve(saved.get(rel) ?? null),
      write: (rel: string, text: string) => {
        saved.set(rel, text);
        return Promise.resolve();
      },
    };
    await new SectionVersions(f, "dev1", undefined, memory).opened("Plan.md", DOC);
    // Closed; a pull changes Risks; the doc opens again in a new run.
    const pulled = DOC.replace("untested", "tested by CI");
    await new SectionVersions(f, "dev1", undefined, memory).opened("Plan.md", pulled);
    const outside = (await versionsIn(f)).filter(([, c]) => c === "outside");
    expect(outside).toEqual([["Plan > Risks", "outside", "## Risks\n\nThe host is tested by CI."]]);
    // Opening it again unchanged records nothing more.
    await new SectionVersions(f, "dev1", undefined, memory).opened("Plan.md", pulled);
    expect((await versionsIn(f)).filter(([, c]) => c === "outside")).toHaveLength(1);
  });

  it("store one typing version per editing session, for the sections typed in", async () => {
    const f = folder();
    const v = new SectionVersions(f, "dev1", undefined, null, 30);
    await v.opened("Plan.md", DOC);
    await v.saved("Plan.md", DOC.replace("untested", "untested on"));
    await v.saved("Plan.md", DOC.replace("untested", "untested on Linux"));
    await new Promise((r) => setTimeout(r, 80));
    const typing = (await versionsIn(f)).filter(([, c]) => c === "typing");
    expect(typing).toEqual([
      ["Plan > Risks", "typing", "## Risks\n\nThe host is untested on Linux."],
    ]);
  });

  it("end a session when asked, and store nothing for typing undone back", async () => {
    const f = folder();
    const v = new SectionVersions(f, "dev1");
    await v.opened("Plan.md", DOC);
    await v.saved("Plan.md", DOC.replace("Monday", "Tuesday"));
    await v.saved("Plan.md", DOC);
    await v.endSession("Plan.md");
    expect((await versionsIn(f)).filter(([, c]) => c === "typing")).toEqual([]);
    await v.saved("Plan.md", DOC.replace("Monday", "Tuesday"));
    await v.endAll();
    expect((await versionsIn(f)).filter(([, c]) => c === "typing").map(([p]) => p)).toEqual([
      "Plan",
    ]);
  });

  it("write an Apply once: the typing session it lands in doesn't record it again", async () => {
    const f = folder();
    const v = new SectionVersions(f, "dev1");
    await v.opened("Plan.md", DOC);
    const applied = DOC.replace("The host is untested.", "The host passed its tests.");
    const at = await v.locate("Plan.md", DOC);
    const risks = at?.ids[1];
    if (!risks) throw new Error("no section");
    await v.applied(
      "Plan.md",
      risks,
      "## Risks\n\nThe host passed its tests.\n",
      ["Plan", "Risks"],
      "pt1",
      "t1",
    );
    await v.saved("Plan.md", applied);
    await v.endAll();
    expect((await versionsIn(f)).filter(([p]) => p === "Plan > Risks").map(([, c]) => c)).toEqual([
      "apply",
      "start",
    ]);
  });

  it("settle an Apply cut short by a crash: abandoned when the edit never landed, landed when it did", async () => {
    const f = folder();
    const v = new SectionVersions(f, "dev1");
    await v.opened("Plan.md", DOC);
    const at = await v.locate("Plan.md", DOC);
    const risks = at?.ids[1];
    if (!risks) throw new Error("no section");
    // History has the Apply's version; then Anur stops before the edit lands.
    await v.applied(
      "Plan.md",
      risks,
      "## Risks\n\nThe host passed its tests.\n",
      ["Plan", "Risks"],
      "pt1",
      "t1",
    );
    const reopened = new SectionVersions(f, "dev1");
    await reopened.opened("Plan.md", DOC);
    // And one that landed, from another thread.
    const applied = DOC.replace("The host is untested.", "The host passed its tests.");
    await reopened.applied(
      "Plan.md",
      risks,
      "## Risks\n\nThe host passed its tests.\n",
      ["Plan", "Risks"],
      "pt2",
      "t2",
    );
    const again = new SectionVersions(f, "dev1");
    await again.opened("Plan.md", applied);
    const results: [string, string][] = [];
    const docs = path.join(f, ".anur", "docs");
    for (const doc of await readdir(docs))
      for (const sec of await readdir(path.join(docs, doc, "history")))
        for (const file of await readdir(path.join(docs, doc, "history", sec)))
          for (const line of (await readFile(path.join(docs, doc, "history", sec, file), "utf8"))
            .trim()
            .split("\n")) {
            const l = JSON.parse(line) as { kind: string; preview?: string; result?: string };
            if (l.kind === "apply-result") results.push([l.preview ?? "", l.result ?? ""]);
          }
    expect(results.sort()).toEqual([
      ["pt1", "abandoned"],
      ["pt2", "landed"],
    ]);
  });

  it("keep a doc's ID when Anur moves it, so its history follows", async () => {
    const f = folder();
    const v = new SectionVersions(f, "dev1", (e) => {
      throw e;
    });
    await v.opened("Plan.md", DOC);
    const before = await v.locate("Plan.md", DOC);
    await v.moved([{ from: "Plan.md", to: "Ideas/Plan.md" }]);
    const fresh = new SectionVersions(f, "dev1");
    const after = await fresh.locate("Ideas/Plan.md", DOC);
    expect(after?.doc).toBe(before?.doc);
    expect(after?.ids).toEqual(before?.ids);
  });
});
