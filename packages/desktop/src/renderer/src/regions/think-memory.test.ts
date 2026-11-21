import { describe, expect, it } from "vitest";
import { anyDraft, loadDraft, loadOpenThread, saveDraft, saveOpenThread } from "./think-memory.ts";

function store() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
  };
}

describe("what Think keeps across a restart", () => {
  it("keeps the thread open on each doc, and forgets it when closed", () => {
    const s = store();
    saveOpenThread(s, "Plan.md", "t1");
    saveOpenThread(s, "Notes.md", "t2");
    expect(loadOpenThread(s, "Plan.md")).toBe("t1");
    saveOpenThread(s, "Plan.md", null);
    expect(loadOpenThread(s, "Plan.md")).toBeNull();
    expect(loadOpenThread(s, "Notes.md")).toBe("t2");
  });

  it("keeps unsent text, clears it once sent, and says whether any is waiting", () => {
    const s = store();
    expect(anyDraft(s)).toBe(false);
    saveDraft(s, "thread:t1", "Half a thought");
    expect(loadDraft(s, "thread:t1")).toBe("Half a thought");
    expect(anyDraft(s)).toBe(true);
    saveDraft(s, "thread:t1", "   ");
    expect(loadDraft(s, "thread:t1")).toBe("");
    expect(anyDraft(s)).toBe(false);
  });

  it("never throws when storage does", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      length: 1,
      key: () => {
        throw new Error("blocked");
      },
    };
    expect(loadDraft(broken, "x")).toBe("");
    expect(() => {
      saveDraft(broken, "x", "y");
    }).not.toThrow();
    // Can't tell: treated as typing waiting, so nothing restarts over it.
    expect(anyDraft(broken)).toBe(true);
  });
});
