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
  closeGroup,
  closeOthers,
  closeToRight,
  foldGroup,
  joinGroup,
  leaveGroup,
  move,
  newGroup,
  setPinned,
  ungroup,
  updateGroup,
  renamePaths,
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

  it("close: a tab just opened goes back to the tab it came from, as in a browser", () => {
    // a, b, c; from a, open d: it sits right after a, before b.
    let t = open(open(open(noTabs, "a.md"), "b.md", true), "c.md", true);
    const [a] = t.tabs;
    t = open(select(t, a?.id ?? ""), "d.md", true);
    expect(currentDoc(t)).toBe("d.md");
    t = close(t, t.active ?? "");
    expect(currentDoc(t)).toBe("a.md");
    // Went elsewhere first: the neighbour takes focus, as before.
    t = open(t, "e.md", true);
    const e = t.active ?? "";
    t = select(select(t, t.tabs.at(-1)?.id ?? ""), e);
    t = close(t, e);
    expect(currentDoc(t)).toBe("b.md");
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

/** Tabs a…e, each showing `<id>.md`, with c active. */
function five(): Tabs {
  const tabs = ["a", "b", "c", "d", "e"].map((id) => ({ id, history: [`${id}.md`], index: 0 }));
  return { tabs, active: "c", groups: [] };
}
const ids = (t: Tabs) => t.tabs.map((x) => x.id).join("");
/** Ids with each group's tabs in brackets and pins marked with ^. */
const shape = (t: Tabs) =>
  t.tabs
    .map((x, i) => {
      const prev = t.tabs[i - 1]?.group;
      const next = t.tabs[i + 1]?.group;
      const open = x.group && x.group !== prev ? "[" : "";
      const shut = x.group && x.group !== next ? "]" : "";
      return `${open}${x.pinned ? "^" : ""}${x.id}${shut}`;
    })
    .join("");
function grouped(t: Tabs, members: string[]) {
  const first = newGroup(t, members[0] ?? "");
  let next = first.tabs;
  for (const id of members.slice(1)) next = joinGroup(next, id, first.group ?? "");
  return { tabs: next, group: first.group ?? "" };
}

describe("moving, pinning and grouping tabs", () => {
  it("move a tab before another, or to the end", () => {
    expect(ids(move(five(), "e", "b"))).toBe("aebcd");
    expect(ids(move(five(), "a", null))).toBe("bcdea");
    expect(ids(move(five(), "c", "c"))).toBe("abcde");
  });

  it("pinned tabs go to the left and stay among the pins", () => {
    let t = setPinned(five(), "d", true);
    expect(shape(t)).toBe("^dabce");
    t = setPinned(t, "b", true);
    expect(shape(t)).toBe("^d^bace");
    expect(shape(move(t, "e", "d"))).toBe("^d^beac");
    expect(shape(move(t, "d", null))).toBe("^b^dace");
    expect(shape(setPinned(t, "d", false))).toBe("^bdace");
  });

  it("a link in a pinned tab opens in a new tab", () => {
    const t = open(setPinned(five(), "c", true), "x.md");
    expect(docsOf(t)).toEqual(["c.md", "x.md", "a.md", "b.md", "d.md", "e.md"]);
    expect(t.active).toBe(t.tabs[1]?.id);
  });

  it("groups keep their tabs together, joined, left and dropped into", () => {
    const { tabs, group } = grouped(five(), ["b", "d"]);
    expect(shape(tabs)).toBe("a[bd]ce");
    expect(tabs.groups.map((g) => g.color)).toEqual(["blue"]);
    expect(shape(move(tabs, "e", "d"))).toBe("a[bed]c");
    expect(shape(move(tabs, "d", null))).toBe("a[b]ced");
    expect(shape(move(tabs, "b", "c"))).toBe("a[db]ce");
    expect(shape(leaveGroup(tabs, "b"))).toBe("a[d]bce");
    expect(shape(ungroup(tabs, group))).toBe("abdce");
    expect(newGroup(tabs, "e").tabs.groups.map((g) => g.color)).toEqual(["blue", "green"]);
    expect(updateGroup(tabs, group, { name: "Design" }).groups[0]?.name).toBe("Design");
  });

  it("a tab dropped over a group joins it, even a group of one", () => {
    const { tabs, group } = grouped(five(), ["b"]);
    expect(shape(move(tabs, "e", "c", group))).toBe("a[be]cd");
    expect(shape(move(tabs, "e", "b", group))).toBe("a[eb]cd");
    expect(shape(move(tabs, "e", "c", null))).toBe("a[b]ecd");
  });

  it("a group's only tab takes the group with it", () => {
    const { tabs } = grouped(five(), ["b"]);
    expect(shape(move(tabs, "b", null, null))).toBe("acde[b]");
    expect(shape(move(tabs, "b", "e"))).toBe("acd[b]e");
  });

  it("dropped away from its group, over no group, a tab leaves it", () => {
    const { tabs } = grouped(five(), ["b", "c"]);
    expect(shape(move(tabs, "b", null, null))).toBe("a[c]deb");
  });

  it("pinning a grouped tab takes it out of the group, and an empty group goes", () => {
    const { tabs } = grouped(five(), ["b"]);
    const t = setPinned(tabs, "b", true);
    expect(shape(t)).toBe("^bacde");
    expect(t.groups).toEqual([]);
  });

  it("a new tab joins the active tab's group", () => {
    const { tabs } = grouped(five(), ["c", "d"]);
    const t = newTab(tabs);
    expect(shape(t).replace(/t\d+-\d+/, "n")).toBe("ab[cnd]e");
  });

  it("folding the active tab's group moves focus to the next tab on show; ⌃Tab skips it", () => {
    const { tabs, group } = grouped(five(), ["c", "d"]);
    const t = foldGroup(tabs, group, true);
    expect(t.active).toBe("e");
    expect(cycle(t, -1).active).toBe("b");
    expect(foldGroup(t, group, false).active).toBe("e");
  });

  it("close others, to the right and a whole group, keeping pins", () => {
    const t = setPinned(five(), "a", true);
    expect(ids(closeOthers(t, "c"))).toBe("ac");
    expect(ids(closeToRight(t, "c"))).toBe("abc");
    const g = grouped(t, ["c", "d"]);
    const closed = closeGroup(g.tabs, g.group);
    expect(ids(closed)).toBe("abe");
    expect(closed.active).toBe("e");
    expect(closed.groups).toEqual([]);
  });

  it("pins, groups and folds are remembered", () => {
    const storage = memory();
    const g = grouped(setPinned(five(), "a", true), ["d", "e"]);
    const t = foldGroup(
      updateGroup(g.tabs, g.group, { name: "Later", color: "amber" }),
      g.group,
      true,
    );
    saveTabs(storage, "/f", t);
    const back = loadTabs(storage, "/f", ["a.md", "b.md", "c.md", "d.md", "e.md"]);
    expect(shape(back)).toBe("^abc[de]");
    expect(back.groups).toEqual([{ id: g.group, name: "Later", color: "amber", folded: true }]);
  });

  it("any run of moves, pins and groups keeps pins first and each group in one piece", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let run = 0; run < 200; run++) {
      let t = five();
      for (let step = 0; step < 30; step++) {
        const pick = () => t.tabs[rand(t.tabs.length)]?.id ?? "a";
        const g = t.groups[rand(Math.max(1, t.groups.length))]?.id;
        const op = rand(7);
        if (op === 0) t = move(t, pick(), rand(4) === 0 ? null : pick(), rand(3) ? g : null);
        else if (op === 1) t = setPinned(t, pick(), rand(2) === 0);
        else if (op === 2) t = newGroup(t, pick()).tabs;
        else if (op === 3 && g) t = joinGroup(t, pick(), g);
        else if (op === 4) t = leaveGroup(t, pick());
        else if (op === 5 && g) t = foldGroup(t, g, rand(2) === 0);
        else t = move(t, pick(), pick());
        expect(t.tabs.length).toBe(5);
        const pins = t.tabs.map((x) => Boolean(x.pinned));
        expect(pins.indexOf(false) === -1 || !pins.slice(pins.indexOf(false)).includes(true)).toBe(
          true,
        );
        expect(t.tabs.every((x) => !x.pinned || !x.group)).toBe(true);
        const runs = t.tabs.map((x) => x.group).filter((x, i, a) => x && x !== a[i - 1]);
        expect(new Set(runs).size).toBe(runs.length);
        expect(new Set(t.tabs.map((x) => x.group).filter(Boolean))).toEqual(
          new Set(t.groups.map((x) => x.id)),
        );
      }
    }
  });

  it("follow docs renamed or moved in the files panel, back and forward too", () => {
    let t = open(open(noTabs, "a.md"), "b.md");
    t = renamePaths(t, [{ from: "a.md", to: "Ideas/a.md" }]);
    expect(t.tabs[0]?.history).toEqual(["Ideas/a.md", "b.md"]);
  });
});
