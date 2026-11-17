/**
 * What the page can insert (tasks 2.10 and 2.12): one list for the "/" menu
 * in the page and the Insert menu in the menu bar, so the two never drift.
 * Each item names its "/" command and, where it has one, its shortcut.
 */
export const INSERT_ITEMS = [
  { id: "table", label: "Table", slash: "/table", detail: "3 × 3" },
  { id: "h1", label: "Heading 1", slash: "/h1", accelerator: "CmdOrCtrl+Alt+1", keys: "⌘⌥1" },
  { id: "h2", label: "Heading 2", slash: "/h2", accelerator: "CmdOrCtrl+Alt+2", keys: "⌘⌥2" },
  { id: "h3", label: "Heading 3", slash: "/h3", accelerator: "CmdOrCtrl+Alt+3", keys: "⌘⌥3" },
  { id: "body", label: "Body text", slash: "/body", accelerator: "CmdOrCtrl+Alt+0", keys: "⌘⌥0" },
  {
    id: "bullets",
    label: "Bulleted list",
    slash: "/bullet",
    accelerator: "CmdOrCtrl+Shift+8",
    keys: "⌘⇧8",
  },
  {
    id: "numbers",
    label: "Numbered list",
    slash: "/numbered",
    accelerator: "CmdOrCtrl+Shift+7",
    keys: "⌘⇧7",
  },
  { id: "tasks", label: "Task list", slash: "/task" },
  { id: "note", label: "Callout: note", slash: "/note" },
  { id: "tip", label: "Callout: tip", slash: "/tip" },
  { id: "warning", label: "Callout: warning", slash: "/warning" },
  { id: "code", label: "Code block", slash: "/code" },
  { id: "divider", label: "Divider", slash: "/divider" },
  { id: "link", label: "Link to a doc", slash: "[[", keys: "[[" },
] as const;

export type InsertItem = (typeof INSERT_ITEMS)[number];
export type InsertId = InsertItem["id"];
export const INSERT_IDS = INSERT_ITEMS.map((i) => i.id) as [InsertId, ...InsertId[]];
