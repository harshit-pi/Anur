import { describe, expect, it } from "vitest";
import type { FolderState } from "../../../shared/ipc-contract.ts";
import { keepSame } from "./keep-same.ts";

const folder = (over: Partial<FolderState> = {}): FolderState => ({
  name: "F",
  path: "/f",
  mode: "writable",
  reason: null,
  docs: ["a.md", "b.md"],
  folders: [],
  files: [],
  times: { "a.md": [1, 1] },
  truncated: false,
  cloud: "icloud",
  gitInCloud: false,
  offloaded: ["b.md"],
  conflicts: [],
  ...over,
});

describe("keepSame", () => {
  it("keeps the old listing when nothing changed", () => {
    const was = folder();
    expect(keepSame(was, folder())).toBe(was);
  });

  it("reuses the unchanged parts when a download lands", () => {
    const was = folder();
    const now = keepSame(was, folder({ offloaded: [] }));
    expect(now).not.toBe(was);
    expect(now?.offloaded).toEqual([]);
    expect(now?.docs).toBe(was.docs);
    expect(now?.times).toBe(was.times);
  });

  it("takes another folder as it is", () => {
    const now = folder({ path: "/g" });
    expect(keepSame(folder(), now)).toBe(now);
  });
});
