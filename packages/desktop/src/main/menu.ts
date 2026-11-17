import { Menu, type MenuItemConstructorOptions } from "electron";
import { INSERT_ITEMS, type InsertId } from "../shared/insert-items.ts";

/**
 * The application menu. Electron's own Edit roles are kept so copy, paste
 * and undo keep working in every text field.
 */
export function buildMenu(actions: {
  openFolder: () => void;
  newWindow: () => void;
  insert: (id: InsertId) => void;
  isDev: boolean;
}): Menu {
  const mac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: actions.newWindow },
        { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: actions.openFolder },
        { type: "separator" },
        mac ? { role: "close" } : { role: "quit" },
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
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}
