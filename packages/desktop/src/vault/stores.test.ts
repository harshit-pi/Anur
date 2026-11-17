import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsStore } from "./settings-store.ts";
import { SnapshotStore, hashOf } from "./snapshot-store.ts";

let anurDir: string;
beforeEach(() => {
  anurDir = path.join(mkdtempSync(path.join(tmpdir(), "anur-stores-")), ".anur");
});
afterEach(() => {
  rmSync(path.dirname(anurDir), { recursive: true, force: true });
});

const bytes = (s: string) => new TextEncoder().encode(s);

describe("the snapshot store", () => {
  it("stores bytes once, under their SHA-256", async () => {
    const store = new SnapshotStore(anurDir, "dev1");
    const h1 = await store.put(bytes("Retry after 1 hour."));
    const h2 = await store.put(bytes("Retry after 1 hour."));
    expect(h1).toBe(h2);
    expect(h1).toBe(createHash("sha256").update("Retry after 1 hour.").digest("hex"));
    expect(new TextDecoder().decode((await store.get(h1)) ?? new Uint8Array())).toBe(
      "Retry after 1 hour.",
    );
  });

  it("deletes at once and tells every device through a tombstone", async () => {
    const mine = new SnapshotStore(anurDir, "dev1");
    const theirs = new SnapshotStore(anurDir, "dev2");
    const h = await mine.put(bytes("secret"));
    await mine.delete(h, "person");
    expect(await mine.get(h)).toBeNull();
    expect(await theirs.deleted()).toEqual(new Set([h]));
  });

  it("refuses a file whose bytes no longer match its name", async () => {
    const store = new SnapshotStore(anurDir, "dev1");
    const h = await store.put(bytes("original"));
    writeFileSync(path.join(anurDir, "snapshots", h), "tampered");
    expect(await store.get(h)).toBeNull();
  });

  it("knows nothing was deleted in a new folder", async () => {
    expect(await new SnapshotStore(anurDir, "dev1").deleted()).toEqual(new Set());
    expect(hashOf(bytes(""))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the settings store", () => {
  it("writes only this device's file and reads every device's", async () => {
    let clock = Date.UTC(2026, 10, 17, 1);
    const laptop = new SettingsStore(anurDir, "laptop", () => clock);
    const desktop = new SettingsStore(anurDir, "desktop", () => clock);
    await laptop.set("git.commitAnur", false);
    clock += 1000;
    await desktop.set("git.commitAnur", true);
    await laptop.set("sessions.limit", 8);
    expect(await laptop.all()).toEqual({ "git.commitAnur": true, "sessions.limit": 8 });
    expect(await desktop.all()).toEqual(await laptop.all());
  });

  it("reads a new folder as no settings", async () => {
    expect(await new SettingsStore(anurDir, "dev1").all()).toEqual({});
  });
});
