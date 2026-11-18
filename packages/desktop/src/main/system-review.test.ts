import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readReview } from "@anur/system";
import { SystemReview, briefsFrom } from "./system-review.ts";

const sections = [
  { id: "repo:r", path: ["api"], text: "", parent: null },
  { id: "group:r/tables", path: ["api", "Tables"], text: "", parent: "repo:r" },
  { id: "group:r/services", path: ["api", "Services"], text: "", parent: "repo:r" },
  {
    id: "group:r/services/other",
    path: ["api", "Services", "Other"],
    text: "",
    parent: "group:r/services",
  },
  { id: "part:1", path: ["api", "UsersTable"], text: "", parent: "group:r/tables" },
  { id: "part:2", path: ["api", "WebhookStack"], text: "", parent: "group:r/services/other" },
];
const tick = () => new Promise((r) => setTimeout(r, 10));

describe("Claude's names for groups (20.6)", () => {
  it("tells Claude each group's repo, place and parts", () => {
    expect(briefsFrom(sections, new Set(["group:r/services/other", "group:r/services"]))).toEqual([
      {
        id: "group:r/services",
        repo: "api",
        name: "Services",
        within: [],
        parts: ["WebhookStack"],
      },
      {
        id: "group:r/services/other",
        repo: "api",
        name: "Other",
        within: ["Services"],
        parts: ["WebhookStack"],
      },
    ]);
  });

  it("asks once, keeps only sibling merges, and lets the person decide", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-names-"));
    const changed: string[] = [];
    const review = new SystemReview((f) => changed.push(f));
    let asks = 0;
    const ask = () => {
      asks++;
      return Promise.resolve(
        JSON.stringify([
          {
            id: "group:r/tables",
            name: "Ledgers",
            merge: ["group:r/services", "group:r/services/other"],
          },
          { id: "group:r/services", name: "Services", merge: [] },
        ]),
      );
    };
    expect(review.view(dir, sections, ask).asking).toBe(true);
    await tick();
    const v = review.view(dir, sections, ask);
    expect(asks).toBe(1);
    // "Services" kept its name: settled without asking the person.
    expect(v.pending).toEqual([
      { group: "group:r/tables", name: "Ledgers", merge: ["group:r/services"] },
    ]);
    expect(changed).toEqual([dir]);
    review.decide(dir, { group: "group:r/tables", action: "accept", parts: ["part:1"] });
    const after = review.view(dir, sections, ask);
    expect(after.pending).toEqual([]);
    expect(after.reviewed).toEqual(["part:1"]);
    expect(readReview(dir).at(-2)).toMatchObject({ kind: "accepted", group: "group:r/tables" });
  });

  it("doesn't ask again on its own after a failure, until Try again", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-names-"));
    const review = new SystemReview(() => undefined);
    let asks = 0;
    const fail = () => {
      asks++;
      return Promise.reject(new Error("Not signed in"));
    };
    review.view(dir, sections, fail);
    await tick();
    expect(review.view(dir, sections, fail).failed).toBe("Not signed in");
    expect(asks).toBe(1);
    review.retry(dir);
    review.view(dir, sections, fail);
    expect(asks).toBe(2);
  });
});
