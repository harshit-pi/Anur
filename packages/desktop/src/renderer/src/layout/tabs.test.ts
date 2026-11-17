import { describe, expect, it } from "vitest";
import {
  back,
  canGoBack,
  canGoForward,
  close,
  currentDoc,
  cycle,
  forward,
  loadTabs,
  newTab,
  noTabs,
  open,
  prune,
  saveTabs,
  select,
  titleOf,
  type Tabs,
} from "./tabs.ts";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

const docsOf = (t: Tabs) => t.tabs.map((tab) => tab.history[tab.index] ?? null);

describe("tabs", () => {
  it("open the first doc in a new tab, then in the active tab", () => {
    let t = open(noTabs, "a.md");
    expect(docsOf(t)).toEqual(["a.md"]);
    t = open(t, "b.md");
    expect(docsOf(t)).toEqual(["b.md"]);
    expect(t.tabs[0]?.history).toEqual(["a.md", "b.md"]);
  });

  it("open in a new tab when asked, right after the active one", () => {
    let t = open(open(noTabs, "a.md"), "b.md", true);
    t = select(t, t.tabs[0]?.id ?? "");
    t = open(t, "c.md", true);
    expect(docsOf(t)).toEqual(["a.md", "c.md", "b.md"]);
    expect(currentDoc(t)).toBe("c.md");
  });

  it("go back and forward within a tab, and branch off on a new open", () => {
    let t = open(open(open(noTabs, "a.md"), "b.md"), "c.md");
    t = back(back(t));
    expect(currentDoc(t)).toBe("a.md");
    expect(canGoBack(t)).toBe(false);
    t = forward(t);
    expect(currentDoc(t)).toBe("b.md");
    t = open(t, "d.md");
    expect(t.tabs[0]?.history).toEqual(["a.md", "b.md", "d.md"]);
    expect(canGoForward(t)).toBe(false);
  });

  it("close: the tab to the right takes focus, else the one to the left", () => {
    let t = open(open(open(noTabs, "a.md"), "b.md", true), "c.md", true);
    const [a, b] = t.tabs;
    t = select(t, b?.id ?? "");
    t = close(t, b?.id ?? "");
    expect(currentDoc(t)).toBe("c.md");
    t = close(t, t.active ?? "");
    expect(currentDoc(t)).toBe("a.md");
    t = close(t, a?.id ?? "");
    expect(t).toEqual(noTabs);
  });

  it("a new tab is empty until a doc opens in it", () => {
    const t = newTab(open(noTabs, "a.md"));
    expect(currentDoc(t)).toBeNull();
    expect(titleOf(t.tabs[1] ?? { id: "", history: [], index: -1 })).toBe("New tab");
    expect(currentDoc(open(t, "b.md"))).toBe("b.md");
    expect(titleOf(t.tabs[0] ?? { id: "", history: [], index: -1 })).toBe("a");
  });

  it("cycle through tabs, wrapping round", () => {
    const t = open(open(noTabs, "a.md"), "b.md", true);
    expect(currentDoc(cycle(t, 1))).toBe("a.md");
    expect(currentDoc(cycle(t, -1))).toBe("a.md");
  });

  it("drop docs the folder no longer has", () => {
    let t = open(open(open(noTabs, "a.md"), "b.md"), "c.md", true);
    t = prune(t, ["a.md", "c.md"]);
    expect(docsOf(t)).toEqual(["c.md"]);
    t = open(open(open(noTabs, "a.md"), "gone.md"), "b.md");
    expect(prune(t, ["a.md", "b.md"]).tabs[0]?.history).toEqual(["a.md", "b.md"]);
  });

  it("are remembered per folder, without docs that have gone", () => {
    const storage = memory();
    const t = open(open(noTabs, "a.md"), "b.md", true);
    saveTabs(storage, "/Vault", t);
    const back = loadTabs(storage, "/Vault", ["b.md"]);
    expect(docsOf(back)).toEqual(["b.md"]);
    expect(loadTabs(storage, "/Other", ["a.md"])).toEqual(noTabs);
    storage.setItem("anur.tabs:/Vault", "{broken");
    expect(loadTabs(storage, "/Vault", ["a.md"])).toEqual(noTabs);
  });
});
