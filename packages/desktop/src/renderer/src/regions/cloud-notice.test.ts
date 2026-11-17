import { describe, expect, it } from "vitest";
import { cloudSummary, markNoticeSeen, noticeSeen } from "./cloud-notice.ts";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

describe("the cloud notice", () => {
  it("shows for a folder until it is dismissed, then stays dismissed", () => {
    const storage = memory();
    expect(noticeSeen(storage, "/Vault")).toBe(false);
    markNoticeSeen(storage, "/Vault");
    expect(noticeSeen(storage, "/Vault")).toBe(true);
    expect(noticeSeen(storage, "/Other")).toBe(false);
  });

  it("shows again when storage is unreadable or blocked", () => {
    const storage = memory();
    storage.setItem("anur.cloudNoticeSeen", "{broken");
    expect(noticeSeen(storage, "/Vault")).toBe(false);
    expect(noticeSeen(undefined, "/Vault")).toBe(false);
    expect(() => {
      markNoticeSeen(undefined, "/Vault");
    }).not.toThrow();
  });

  it("says nothing for a folder no sync service manages", () => {
    expect(cloudSummary({ cloud: null, offloaded: [], gitInCloud: false })).toBeNull();
  });

  it("counts docs still in iCloud and warns about a git repo", () => {
    expect(cloudSummary({ cloud: "icloud", offloaded: ["a.md"], gitInCloud: true })).toEqual([
      "This folder syncs through iCloud Drive. Anur keeps its caches and its lock on this Mac, outside the folder.",
      "1 doc is still in iCloud; Anur downloads each one before opening it.",
      "It is also a git repo: sync can break git's lock files, so a repo is safer outside a synced folder.",
    ]);
  });
});
