import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RecoveryStore } from "./recovery.ts";

describe("the crash journal", () => {
  const store = () => new RecoveryStore(mkdtempSync(path.join(tmpdir(), "anur-recovery-")));

  it("keeps a doc's unsaved text until it's cleared", async () => {
    const s = store();
    await s.write("/f", "Plan.md", { text: "typed", saved: "saved" });
    expect(await s.read("/f", "Plan.md")).toMatchObject({ text: "typed", saved: "saved" });
    await s.clear("/f", "Plan.md");
    expect(await s.read("/f", "Plan.md")).toBeNull();
  });

  it("keeps each folder's and each doc's apart", async () => {
    const s = store();
    await s.write("/f", "Plan.md", { text: "a", saved: "" });
    expect(await s.read("/g", "Plan.md")).toBeNull();
    expect(await s.read("/f", "Other.md")).toBeNull();
  });
});
