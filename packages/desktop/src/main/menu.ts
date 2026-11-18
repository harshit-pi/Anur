import { Menu, app, type MenuItemConstructorOptions } from "electron";
import { INSERT_ITEMS, type InsertId } from "../shared/insert-items.ts";

/**
 * The application menu. Electron's own Edit roles are kept so copy, paste
 * and undo keep working in every text field.
 */
export function buildMenu(actions: {
  openFolder: () => void;
  newFolder: () => void;
  checkUpdates: () => void;
  newWindow: () => void;
  insert: (id: InsertId) => void;
  command: (
    c: "tab-new" | "tab-close" | "back" | "forward" | "tab-next" | "tab-prev" | "tour" | "updates",
  ) => void;
  isDev: boolean;
}): Menu {
  const mac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    // The app menu as macOS draws it, with Check for Updates under About.
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { label: "Check for Updates…", click: actions.checkUpdates },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          id: "tab-new",
          label: "New Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => {
            actions.command("tab-new");
          },
        },
        { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: actions.newWindow },
        { label: "New Folder…", click: actions.newFolder },
        { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: actions.openFolder },
        { type: "separator" },
        {
          id: "tab-close",
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => {
            actions.command("tab-close");
          },
        },
        mac
          ? { role: "close", label: "Close Window", accelerator: "CmdOrCtrl+Shift+W" }
          : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      // Each block with its "/" command beneath it and its shortcut beside it.
      // The page handles the shortcuts itself, so they are shown, not registered.
      label: "Insert",
      submenu: INSERT_ITEMS.map((item) => ({
        id: `insert-${item.id}`,
        label: item.label,
        sublabel: item.slash,
        ...("accelerator" in item
          ? { accelerator: item.accelerator, registerAccelerator: false }
          : {}),
        click: () => {
          actions.insert(item.id);
        },
      })),
    },
    {
      label: "View",
      submenu: [
        ...(actions.isDev
          ? [
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
              { type: "separator" as const },
            ]
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Go",
      submenu: [
        // ⌘[ and ⌘], as in Chrome, Safari and Finder; ⌘⌥← and ⌘⌥→ still work, unlisted.
        {
          id: "go-back",
          label: "Back",
          accelerator: "CmdOrCtrl+[",
          click: () => {
            actions.command("back");
          },
        },
        {
          id: "go-forward",
          label: "Forward",
          accelerator: "CmdOrCtrl+]",
          click: () => {
            actions.command("forward");
          },
        },
        {
          label: "Back",
          accelerator: "CmdOrCtrl+Alt+Left",
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => {
            actions.command("back");
          },
        },
        {
          label: "Forward",
          accelerator: "CmdOrCtrl+Alt+Right",
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => {
            actions.command("forward");
          },
        },
        { type: "separator" },
        {
          id: "tab-next",
          label: "Next Tab",
          accelerator: "Ctrl+Tab",
          click: () => {
            actions.command("tab-next");
          },
        },
        {
          id: "tab-prev",
          label: "Previous Tab",
          accelerator: "Ctrl+Shift+Tab",
          click: () => {
            actions.command("tab-prev");
          },
        },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Show the Tour Again",
          click: () => {
            actions.command("tour");
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
