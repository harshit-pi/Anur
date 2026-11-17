/**
 * Tabs (task 2.15): each tab shows one doc at a time and keeps the docs it
 * has shown, so back and forward move within the tab. Which tabs are open is
 * remembered per folder, on this device, in the page's own storage.
 */

export type Tab = { id: string; history: string[]; index: number };
export type Tabs = { tabs: Tab[]; active: string | null };

export const noTabs: Tabs = { tabs: [], active: null };

let counter = 0;
const newId = () => `t${String(Date.now())}-${String(++counter)}`;

export const activeTab = (t: Tabs) => t.tabs.find((x) => x.id === t.active) ?? null;

/** The doc a tab shows, or null for a new, empty tab. */
export const docOf = (tab: Tab | null) => (tab ? (tab.history[tab.index] ?? null) : null);

export const currentDoc = (t: Tabs) => docOf(activeTab(t));

/** A tab's title: its doc's name, without the folder or ".md". */
export function titleOf(tab: Tab): string {
  const path = docOf(tab);
  if (!path) return "New tab";
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

const replaceTab = (t: Tabs, tab: Tab): Tabs => ({
  ...t,
  tabs: t.tabs.map((x) => (x.id === tab.id ? tab : x)),
});

/** A new, empty tab after the active one, which it becomes. */
export function newTab(t: Tabs, path: string | null = null): Tabs {
  const tab: Tab = { id: newId(), history: path ? [path] : [], index: path ? 0 : -1 };
  const at = t.tabs.findIndex((x) => x.id === t.active);
  const tabs = [...t.tabs.slice(0, at + 1), tab, ...t.tabs.slice(at + 1)];
  return { tabs, active: tab.id };
}

/**
 * Open `path`: in a new tab when asked, or when there is none; otherwise in
 * the active tab, where it becomes the next step of the tab's history.
 */
export function open(t: Tabs, path: string, inNewTab = false): Tabs {
  const tab = activeTab(t);
  if (inNewTab || !tab) return newTab(t, path);
  if (docOf(tab) === path) return t;
  const history = [...tab.history.slice(0, tab.index + 1), path];
  return replaceTab(t, { ...tab, history, index: history.length - 1 });
}

export function select(t: Tabs, id: string): Tabs {
  return t.tabs.some((x) => x.id === id) ? { ...t, active: id } : t;
}

/** Close a tab; the one to its right takes focus, or else the one to its left. */
export function close(t: Tabs, id: string): Tabs {
  const at = t.tabs.findIndex((x) => x.id === id);
  if (at < 0) return t;
  const tabs = t.tabs.filter((x) => x.id !== id);
  if (t.active !== id) return { ...t, tabs };
  const next = tabs[at] ?? tabs[at - 1] ?? null;
  return { tabs, active: next?.id ?? null };
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

/** Move to the next or previous tab, wrapping round. */
export function cycle(t: Tabs, step: 1 | -1): Tabs {
  if (t.tabs.length === 0) return t;
  const at = Math.max(
    0,
    t.tabs.findIndex((x) => x.id === t.active),
  );
  const next = t.tabs[(at + step + t.tabs.length) % t.tabs.length];
  return next ? { ...t, active: next.id } : t;
}

/**
 * Keep only docs the folder still has: a tab's history drops the rest, and a
 * tab whose own doc is gone closes.
 */
export function prune(t: Tabs, docs: readonly string[]): Tabs {
  const has = new Set(docs);
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
    const parsed = JSON.parse(raw) as { tabs?: unknown; active?: unknown };
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.flatMap((x: unknown): Tab[] => {
          const tab = x as Partial<Tab>;
          if (typeof tab.id !== "string" || !Array.isArray(tab.history)) return [];
          const history = tab.history.filter((p): p is string => typeof p === "string");
          const index = typeof tab.index === "number" ? tab.index : history.length - 1;
          return [{ id: tab.id, history, index: Math.min(index, history.length - 1) }];
        })
      : [];
    const active =
      typeof parsed.active === "string" && tabs.some((x) => x.id === parsed.active)
        ? parsed.active
        : (tabs[0]?.id ?? null);
    return prune({ tabs, active }, docs);
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
    storage?.setItem(KEY(folder), JSON.stringify({ tabs, active: t.active }));
  } catch {
    // Storage blocked or full: the tabs just aren't remembered.
  }
}
