/**
 * Tabs (task 2.15): each tab shows one doc at a time and keeps the docs it
 * has shown, so back and forward move within the tab. Which tabs are open is
 * remembered per folder, on this device, in the page's own storage.
 * Tabs move by dragging, pin to the left, and gather in named groups that fold.
 */

import type { MenuEntry } from "../../../shared/ipc-contract.ts";
import { SYSTEM_TAB } from "./system-levels.ts";

export type Tab = {
  id: string;
  history: string[];
  index: number;
  pinned?: boolean | undefined;
  group?: string | undefined;
};
export const GROUP_COLORS = ["blue", "green", "amber", "red", "slate"] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];
export type Group = { id: string; name: string; color: GroupColor; folded: boolean };
export type Tabs = {
  tabs: Tab[];
  active: string | null;
  groups: Group[];
  /**
   * A tab just opened from another, and that one: closing it straight away
   * goes back there, as in a browser. Switching to any tab forgets it.
   */
  opener?: { tab: string; from: string } | null | undefined;
};

export const noTabs: Tabs = { tabs: [], active: null, groups: [], opener: null };

let counter = 0;
const newId = (prefix = "t") => `${prefix}${String(Date.now())}-${String(++counter)}`;

export const groupOf = (t: Tabs, tab: Tab | null | undefined) =>
  tab?.group ? (t.groups.find((g) => g.id === tab.group) ?? null) : null;

/** Tabs on show: those in a folded group are hidden behind its name. */
export const isShown = (t: Tabs, tab: Tab) => !groupOf(t, tab)?.folded;

/**
 * Pins first, then each group's tabs together where its first tab was; a
 * pinned tab has no group, and a group with no tabs goes.
 */
export function tidy(t: Tabs): Tabs {
  const known = new Set(t.groups.map((g) => g.id));
  const all = t.tabs.map((tab) =>
    tab.pinned
      ? { ...tab, group: undefined }
      : tab.group && !known.has(tab.group)
        ? { ...tab, group: undefined }
        : tab,
  );
  const rest = all.filter((x) => !x.pinned);
  const ordered: Tab[] = all.filter((x) => x.pinned);
  const placed = new Set<string>();
  for (const tab of rest) {
    if (!tab.group) ordered.push(tab);
    else if (!placed.has(tab.group)) {
      placed.add(tab.group);
      ordered.push(...rest.filter((x) => x.group === tab.group));
    }
  }
  return { ...t, tabs: ordered, groups: t.groups.filter((g) => placed.has(g.id)) };
}

export const activeTab = (t: Tabs) => t.tabs.find((x) => x.id === t.active) ?? null;

/** The doc a tab shows, or null for a new, empty tab. */
export const docOf = (tab: Tab | null) => (tab ? (tab.history[tab.index] ?? null) : null);

export const currentDoc = (t: Tabs) => docOf(activeTab(t));

/** A tab's title: its doc's name, without the folder or ".md". */
export function titleOf(tab: Tab): string {
  const path = docOf(tab);
  if (!path) return "New tab";
  if (path === SYSTEM_TAB) return "Repos";
  if (path.startsWith("anur:task/")) return "Task";
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

const replaceTab = (t: Tabs, tab: Tab): Tabs => ({
  ...t,
  tabs: t.tabs.map((x) => (x.id === tab.id ? tab : x)),
});

/** A new, empty tab after the active one, in its group, which it becomes. */
export function newTab(t: Tabs, path: string | null = null): Tabs {
  const current = activeTab(t);
  const group = current && !current.pinned && isShown(t, current) ? current.group : undefined;
  const tab: Tab = { id: newId(), history: path ? [path] : [], index: path ? 0 : -1, group };
  const at = t.tabs.findIndex((x) => x.id === t.active);
  const tabs = [...t.tabs.slice(0, at + 1), tab, ...t.tabs.slice(at + 1)];
  const opener = t.active ? { tab: tab.id, from: t.active } : null;
  return tidy({ ...t, tabs, active: tab.id, opener });
}

/**
 * Open `path`: in a new tab when asked, when there is none, or when the active
 * tab is pinned (it keeps its doc); otherwise in the active tab, where it
 * becomes the next step of the tab's history.
 */
export function open(t: Tabs, path: string, inNewTab = false): Tabs {
  const tab = activeTab(t);
  if (tab && docOf(tab) === path) return t;
  if (inNewTab || !tab || (tab.pinned && docOf(tab) !== null)) return newTab(t, path);
  const history = [...tab.history.slice(0, tab.index + 1), path];
  return replaceTab(t, { ...tab, history, index: history.length - 1 });
}

/** The system tab: the one already open, else a new one. */
export function showSystem(t: Tabs): Tabs {
  const there = t.tabs.find((x) => docOf(x) === SYSTEM_TAB);
  return there ? select(t, there.id) : newTab(t, SYSTEM_TAB);
}

/** Show a tab; a folded group it is in unfolds. */
export function select(t: Tabs, id: string): Tabs {
  const tab = t.tabs.find((x) => x.id === id);
  if (!tab) return t;
  const groups = t.groups.map((g) =>
    g.id === tab.group && g.folded ? { ...g, folded: false } : g,
  );
  return { ...t, active: id, groups, opener: id === t.active ? t.opener : null };
}

/** A new tab at the end of a group, unfolding it. */
export function newTabInGroup(t: Tabs, group: string): Tabs {
  const last = [...t.tabs].reverse().find((x) => x.group === group);
  if (!last) return t;
  return newTab(select(t, last.id));
}

/** The shown tab nearest `at` (an index in t.tabs), looking right first. */
function nearestShown(t: Tabs, at: number, skip: (tab: Tab) => boolean): string | null {
  const ok = (x: Tab | undefined): x is Tab => x !== undefined && !skip(x) && isShown(t, x);
  const right = t.tabs.slice(at).find(ok);
  const left = t.tabs.slice(0, at).reverse().find(ok);
  return (right ?? left)?.id ?? null;
}

/**
 * Close tabs; if the active one goes, the tab it was opened from takes focus
 * when nothing else was shown since, else the nearest on show to its right,
 * else to its left.
 */
export function closeWhere(t: Tabs, gone: (tab: Tab) => boolean): Tabs {
  const at = t.tabs.findIndex((x) => x.id === t.active);
  const closing = at >= 0 && gone(t.tabs[at] as Tab);
  // Just opened from another tab, and closed before going anywhere else: back to that tab.
  const back =
    closing && t.opener?.tab === t.active
      ? t.tabs.find((x) => x.id === t.opener?.from && !gone(x) && isShown(t, x))
      : undefined;
  const active = closing ? (back?.id ?? nearestShown(t, at, gone)) : t.active;
  return tidy({
    ...t,
    tabs: t.tabs.filter((x) => !gone(x)),
    active,
    opener: closing ? null : t.opener,
  });
}

/** Close a tab; focus goes as `closeWhere` says. */
export function close(t: Tabs, id: string): Tabs {
  if (!t.tabs.some((x) => x.id === id)) return t;
  return closeWhere(t, (x) => x.id === id);
}

/** Close every tab but this one and the pinned ones. */
export function closeOthers(t: Tabs, id: string): Tabs {
  return { ...closeWhere(t, (x) => x.id !== id && !x.pinned), active: id };
}

/** Close the unpinned tabs to the right of this one. */
export function closeToRight(t: Tabs, id: string): Tabs {
  const at = t.tabs.findIndex((x) => x.id === id);
  if (at < 0) return t;
  const right = new Set(t.tabs.slice(at + 1).map((x) => x.id));
  return closeWhere(t, (x) => right.has(x.id) && !x.pinned);
}

/**
 * Move a tab to just before `before`, or to the end of its zone (pins or the
 * rest) when null. `over` is the group under the dragged tab when dropped:
 * it joins that group, and null means no group. Without it, a drop between
 * two tabs of one group joins it. A group's only tab takes the group along.
 */
export function move(t: Tabs, id: string, before: string | null, over?: string | null): Tabs {
  const tab = t.tabs.find((x) => x.id === id);
  if (!tab || before === id) return t;
  const rest = t.tabs.filter((x) => x.id !== id);
  const zoneEnd = tab.pinned ? rest.filter((x) => x.pinned).length : rest.length;
  const found = before === null ? -1 : rest.findIndex((x) => x.id === before);
  const firstUnpinned = rest.filter((x) => x.pinned).length;
  let at = found < 0 ? zoneEnd : found;
  at = tab.pinned ? Math.min(at, firstUnpinned) : Math.max(at, firstUnpinned);
  let group = tab.group;
  if (!tab.pinned) {
    const left = rest[at - 1]?.pinned ? undefined : rest[at - 1]?.group;
    const right = rest[at]?.group;
    const alone = Boolean(tab.group) && !rest.some((x) => x.group === tab.group);
    if (over && t.groups.some((g) => g.id === over)) group = over;
    else if (alone) group = tab.group;
    else if (over === null) group = undefined;
    else if (left && left === right) group = left;
    else if (group !== left && group !== right) group = undefined;
  }
  rest.splice(at, 0, { ...tab, group });
  return tidy({ ...t, tabs: rest });
}

/** Pin a tab to the left end, or unpin it to just after the pins. */
export function setPinned(t: Tabs, id: string, pinned: boolean): Tabs {
  const tab = t.tabs.find((x) => x.id === id);
  if (!tab || Boolean(tab.pinned) === pinned) return t;
  const rest = t.tabs.filter((x) => x.id !== id);
  const pins = rest.filter((x) => x.pinned).length;
  rest.splice(pins, 0, { ...tab, pinned: pinned || undefined, group: undefined });
  return tidy({ ...t, tabs: rest });
}

/** Put a tab in a new group with the next free colour; returns the group's id too. */
export function newGroup(t: Tabs, id: string): { tabs: Tabs; group: string | null } {
  const tab = t.tabs.find((x) => x.id === id);
  if (!tab || tab.pinned) return { tabs: t, group: null };
  const used = new Set(t.groups.map((g) => g.color));
  const color = GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[t.groups.length % 5];
  const group: Group = { id: newId("g"), name: "", color: color ?? "blue", folded: false };
  // Leaving an old group in the middle moves the tab out after it.
  const left = leaveGroup(t, id);
  const tabs = left.tabs.map((x) => (x.id === id ? { ...x, group: group.id } : x));
  return { tabs: tidy({ ...left, tabs, groups: [...left.groups, group] }), group: group.id };
}

/** Add a tab to the end of a group. */
export function joinGroup(t: Tabs, id: string, group: string): Tabs {
  const tab = t.tabs.find((x) => x.id === id);
  if (!tab || tab.pinned || !t.groups.some((g) => g.id === group)) return t;
  const rest = t.tabs.filter((x) => x.id !== id);
  const last = rest.map((x) => x.group).lastIndexOf(group);
  rest.splice(last + 1, 0, { ...tab, group });
  return tidy({ ...t, tabs: rest });
}

/** Take a tab out of its group, to just after it. */
export function leaveGroup(t: Tabs, id: string): Tabs {
  const tab = t.tabs.find((x) => x.id === id);
  if (!tab?.group) return t;
  const rest = t.tabs.filter((x) => x.id !== id);
  const last = rest.map((x) => x.group).lastIndexOf(tab.group);
  rest.splice(last < 0 ? t.tabs.indexOf(tab) : last + 1, 0, { ...tab, group: undefined });
  return tidy({ ...t, tabs: rest });
}

export function updateGroup(
  t: Tabs,
  group: string,
  change: Partial<Pick<Group, "name" | "color">>,
): Tabs {
  return { ...t, groups: t.groups.map((g) => (g.id === group ? { ...g, ...change } : g)) };
}

/** Fold or unfold a group; folding the active tab's group moves focus out of it. */
export function foldGroup(t: Tabs, group: string, folded: boolean): Tabs {
  const next = { ...t, groups: t.groups.map((g) => (g.id === group ? { ...g, folded } : g)) };
  const tab = activeTab(t);
  if (!folded || tab?.group !== group) return next;
  const end = t.tabs.map((x) => x.group).lastIndexOf(group);
  return { ...next, active: nearestShown(next, end + 1, () => false) ?? t.active };
}

/** Its tabs stay where they are, no longer grouped. */
export function ungroup(t: Tabs, group: string): Tabs {
  return tidy({
    ...t,
    tabs: t.tabs.map((x) => (x.group === group ? { ...x, group: undefined } : x)),
  });
}

export function closeGroup(t: Tabs, group: string): Tabs {
  return closeWhere(t, (x) => x.group === group);
}

/** The ⌄ list: pins, then each group's tabs under its name, the active one checked. */
export function listItems(t: Tabs): MenuEntry[] {
  const items: MenuEntry[] = [];
  t.tabs.forEach((tab, i) => {
    const prev = t.tabs[i - 1];
    if (prev && (prev.pinned !== tab.pinned || prev.group !== tab.group)) {
      items.push({ separator: true });
    }
    const group = groupOf(t, tab);
    if (group && prev?.group !== tab.group) {
      items.push({ id: `group:${group.id}`, label: group.name || "Unnamed group", enabled: false });
    }
    items.push({ id: tab.id, label: titleOf(tab), checked: tab.id === t.active });
  });
  return items;
}

export const canGoBack = (t: Tabs) => (activeTab(t)?.index ?? 0) > 0;
export const canGoForward = (t: Tabs) => {
  const tab = activeTab(t);
  return tab ? tab.index < tab.history.length - 1 : false;
};

export function back(t: Tabs): Tabs {
  const tab = activeTab(t);
  return tab && canGoBack(t) ? replaceTab(t, { ...tab, index: tab.index - 1 }) : t;
}

export function forward(t: Tabs): Tabs {
  const tab = activeTab(t);
  return tab && canGoForward(t) ? replaceTab(t, { ...tab, index: tab.index + 1 }) : t;
}

/** Move to the next or previous tab on show, wrapping round. */
export function cycle(t: Tabs, step: 1 | -1): Tabs {
  const shown = t.tabs.filter((x) => isShown(t, x) || x.id === t.active);
  if (shown.length === 0) return t;
  const at = Math.max(
    0,
    shown.findIndex((x) => x.id === t.active),
  );
  const next = shown[(at + step + shown.length) % shown.length];
  return next ? { ...t, active: next.id } : t;
}

/** Docs renamed or moved in the files panel: every tab's history follows them. */
export function renamePaths(t: Tabs, moves: readonly { from: string; to: string }[]): Tabs {
  if (moves.length === 0) return t;
  const map = new Map(moves.map((m) => [m.from, m.to]));
  return {
    ...t,
    tabs: t.tabs.map((tab) => ({ ...tab, history: tab.history.map((p) => map.get(p) ?? p) })),
  };
}

/**
 * Keep only docs the folder still has: a tab's history drops the rest, and a
 * tab whose own doc is gone closes.
 */
export function prune(t: Tabs, docs: readonly string[]): Tabs {
  // The system tab and task tabs are no files, and stay.
  const has = new Set([
    ...docs,
    SYSTEM_TAB,
    ...t.tabs.flatMap((x) => x.history).filter((p) => p.startsWith("anur:task/")),
  ]);
  let result = t;
  for (const tab of t.tabs) {
    const current = docOf(tab);
    if (current !== null && !has.has(current)) {
      result = close(result, tab.id);
      continue;
    }
    const before = tab.history.slice(0, tab.index).filter((p) => has.has(p));
    const after = tab.history.slice(tab.index + 1).filter((p) => has.has(p));
    const history = current === null ? [] : [...before, current, ...after];
    const pruned = { ...tab, history, index: current === null ? -1 : before.length };
    if (pruned.history.length !== tab.history.length) result = replaceTab(result, pruned);
  }
  return result;
}

const KEY = (folder: string) => `anur.tabs:${folder}`;

export function loadTabs(
  storage: Pick<Storage, "getItem"> | undefined,
  folder: string,
  docs: readonly string[],
): Tabs {
  try {
    const raw = storage?.getItem(KEY(folder));
    if (!raw) return noTabs;
    const parsed = JSON.parse(raw) as { tabs?: unknown; active?: unknown; groups?: unknown };
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.flatMap((x: unknown): Tab[] => {
          const tab = x as Partial<Tab>;
          if (typeof tab.id !== "string" || !Array.isArray(tab.history)) return [];
          const history = tab.history.filter((p): p is string => typeof p === "string");
          const index = typeof tab.index === "number" ? tab.index : history.length - 1;
          return [
            {
              id: tab.id,
              history,
              index: Math.min(index, history.length - 1),
              pinned: tab.pinned === true || undefined,
              group: typeof tab.group === "string" ? tab.group : undefined,
            },
          ];
        })
      : [];
    const groups = Array.isArray(parsed.groups)
      ? parsed.groups.flatMap((x: unknown): Group[] => {
          const g = x as Partial<Group>;
          if (typeof g.id !== "string") return [];
          const color = GROUP_COLORS.find((c) => c === g.color) ?? "blue";
          const name = typeof g.name === "string" ? g.name.slice(0, 60) : "";
          return [{ id: g.id, name, color, folded: g.folded === true }];
        })
      : [];
    const tidied = tidy({ tabs, active: null, groups });
    const wanted = tidied.tabs.find((x) => x.id === parsed.active);
    const active =
      wanted && isShown(tidied, wanted)
        ? wanted.id
        : (tidied.tabs.find((x) => isShown(tidied, x))?.id ?? null);
    return prune({ ...tidied, active }, docs);
  } catch {
    return noTabs;
  }
}

export function saveTabs(storage: Pick<Storage, "setItem"> | undefined, folder: string, t: Tabs) {
  try {
    // Each tab keeps its last 50 steps, so remembered history stays small.
    const tabs = t.tabs.map((tab) => {
      const drop = Math.max(0, tab.history.length - 50);
      return { ...tab, history: tab.history.slice(drop), index: tab.index - drop };
    });
    storage?.setItem(KEY(folder), JSON.stringify({ tabs, active: t.active, groups: t.groups }));
  } catch {
    // Storage blocked or full: the tabs just aren't remembered.
  }
}
