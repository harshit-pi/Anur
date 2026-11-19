import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppSettingsStore, commitsAnur, setCommitsAnur } from "./app-settings.ts";

const dir = () => mkdtempSync(path.join(tmpdir(), "anur-settings-"));

describe("settings main acts on", () => {
  it("keep every Core feature on by default, and remember a change", async () => {
    const d = dir();
    expect((await new AppSettingsStore(d).load()).features).toEqual({
      links: true,
      history: true,
      actions: true,
    });
    const store = new AppSettingsStore(d);
    await store.load();
    await store.set({ features: { links: true, history: false, actions: false } });
    expect((await new AppSettingsStore(d).load()).features).toEqual({
      links: true,
      history: false,
      actions: false,
    });
  });

  it("carry the old history switch over once", async () => {
    const d = dir();
    writeFileSync(path.join(d, "app-settings.json"), JSON.stringify({ sectionHistory: false }));
    expect((await new AppSettingsStore(d).load()).features.history).toBe(false);
  });

  it("commit .anur/ by taking the * line out, and stop by putting it back, other lines and decisions kept", async () => {
    const f = dir();
    mkdirSync(path.join(f, ".anur"));
    expect(await commitsAnur(f)).toBe(true);
    writeFileSync(path.join(f, ".anur", ".gitignore"), "*\nopen/\n");
    expect(await commitsAnur(f)).toBe(false);
    await setCommitsAnur(f, true);
    expect(await commitsAnur(f)).toBe(true);
    expect(readFileSync(path.join(f, ".anur", ".gitignore"), "utf8")).toBe("open/\n");
    await setCommitsAnur(f, false);
    expect(readFileSync(path.join(f, ".anur", ".gitignore"), "utf8")).toBe(
      "*\nopen/\n!.gitignore\n!decisions/\n!decisions/*.jsonl\n!home-id\n",
    );
    expect(await commitsAnur(f)).toBe(false);
  });
});
