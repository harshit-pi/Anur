import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FORMAT_VERSION } from "@anur/core";
import {
  BrowserWindow,
  Menu,
  clipboard as systemClipboard,
  type MenuItemConstructorOptions,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  session,
  shell,
} from "electron";
import {
  CHANNELS,
  type Channel,
  type EventName,
  type EventPayload,
  type FolderState,
  type MenuEntry,
} from "../shared/ipc-contract.ts";
import { AppSettingsStore, commitsAnur, setCommitsAnur } from "./app-settings.ts";
import { mergeConflict, planConflict } from "./folder/conflicts.ts";
import { FolderService, type OpenOutcome } from "./folder/folder-service.ts";
import { readEmbeddedBase } from "./folder/bases.ts";
import { createDoc, searchFolder } from "./folder/search.ts";
import { openDoc } from "./folder/open-doc.ts";
import { DocWatcher } from "./folder/doc-watcher.ts";
import { Journal } from "./folder/journal.ts";
import { SectionVersions, lastSavedIn } from "./folder/versions.ts";
import { loadDeviceId } from "../device/device-id.ts";
import { RecoveryStore } from "./folder/recovery.ts";
import { saveDoc } from "./folder/save-doc.ts";
import { readRecent } from "./folder/recent.ts";
import { guarded, trustedSenders, type Handler } from "./ipc.ts";
import { buildMenu } from "./menu.ts";

/**
 * The main process stays thin (Architecture, "Processes"): windows, menus,
 * the folder lock and routing checked messages. Parsing, the index and
 * agents run elsewhere.
 */
const here = import.meta.dirname;
const devUrl = process.env.ELECTRON_RENDERER_URL;
const isCheck = Boolean(process.env.ANUR_SCREENSHOT);
const rendererUrl = () =>
  devUrl ?? pathToFileURL(path.join(here, "..", "renderer", "index.html")).href;
const senders = trustedSenders(rendererUrl);

// The app is called Anur. Its profile lives in "Anur Desktop", since
// "Anur" in Application Support belongs to the Mac on the Go app. Checks run
// in a throwaway profile, so they never share storage or locks with a copy
// of Anur that is already open.
app.setName("Anur");
app.setPath(
  "userData",
  isCheck
    ? // ANUR_CHECK_PROFILE lets two check runs share one, to test what is remembered.
      (process.env.ANUR_CHECK_PROFILE ?? mkdtempSync(path.join(tmpdir(), "anur-check-")))
    : path.join(app.getPath("appData"), "Anur Desktop"),
);

// For checks: ANUR_THEME=light or dark overrides the system theme.
const theme = process.env.ANUR_THEME;
if (theme === "light" || theme === "dark") nativeTheme.themeSource = theme;

const windows = new Map<number, BrowserWindow>();
let folders: FolderService;
let journal: Journal;
let appSettings: AppSettingsStore;
let device: string | null = null;
/** The doc each window shows, so leaving it ends its typing session. */
const shownDoc = new Map<number, string>();
/** Section versions (2.21), one writer per open folder; none for a read-only folder. */
const versions = new Map<string, SectionVersions>();
function versionsFor(folder: FolderState): SectionVersions | null {
  if (!device || folder.mode !== "writable" || !appSettings.get().sectionHistory) return null;
  let v = versions.get(folder.path);
  if (!v) {
    v = new SectionVersions(
      folder.path,
      device,
      (e) => {
        console.error("Anur couldn't record section versions:", e);
      },
      lastSavedIn(app.getPath("userData"), folder.path),
    );
    versions.set(folder.path, v);
  }
  return v;
}
let recovery: RecoveryStore;
/** Each window's open doc, watched for changes made outside Anur (2.17). */
const docWatcher = new DocWatcher((windowId, change) => {
  const folder = folders.current(windowId);
  if (folder && change.kind === "changed")
    void versionsFor(folder)?.outside(change.path, change.text);
  const win = windows.get(windowId);
  if (win) send(win, "doc:changed", change);
});

function send<E extends EventName>(win: BrowserWindow, event: E, payload: EventPayload<E>) {
  if (!win.isDestroyed()) win.webContents.send(event, payload);
}

/** Open a folder: in its own window if it is open already, in a new window if this one has a folder. */
async function openFolderIn(win: BrowserWindow, folder: string): Promise<OpenOutcome> {
  let target = win;
  if (folders.current(win.webContents.id)) target = createWindow();
  const outcome = await folders.open(target.webContents.id, folder);
  if (outcome.kind === "opened") {
    target.setTitle(outcome.folder.name);
    target.setRepresentedFilename(outcome.folder.path);
    send(target, "folder:changed", outcome.folder);
    return outcome;
  }
  if (target !== win) target.close();
  if (outcome.kind === "elsewhere") {
    const other = windows.get(outcome.windowId);
    if (other) {
      if (other.isMinimized()) other.restore();
      other.focus();
    }
  }
  return outcome;
}

async function chooseFolder(win: BrowserWindow): Promise<OpenOutcome | { kind: "cancelled" }> {
  const picked = await dialog.showOpenDialog(win, {
    title: "Open a folder",
    buttonLabel: "Open",
    properties: ["openDirectory", "createDirectory"],
  });
  const [folder] = picked.filePaths;
  if (picked.canceled || !folder) return { kind: "cancelled" };
  const outcome = await openFolderIn(win, folder);
  if (outcome.kind === "refused") {
    await dialog.showMessageBox(win, {
      type: "warning",
      message: "Anur can't open this folder",
      detail: outcome.reason,
    });
  }
  return outcome;
}

const handlers: { [C in Channel]: Handler<C> } = {
  "app:info": () => ({
    name: app.getName(),
    version: app.getVersion(),
    formatVersion: FORMAT_VERSION,
    platform: process.platform as "darwin" | "win32" | "linux",
  }),
  "folder:current": (_req, { webContentsId }) => folders.current(webContentsId),
  "folder:choose": async (_req, { webContentsId }) => {
    const win = windows.get(webContentsId);
    if (!win) return { kind: "cancelled" };
    const outcome = await chooseFolder(win);
    return outcome.kind === "elsewhere" ? { kind: "elsewhere" } : outcome;
  },
  "doc:open": async ({ path: requested }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    const opened = await openDoc(folder, requested);
    if (opened.kind === "doc") {
      // Moving to another doc ends the typing session on the one before (2.24).
      const before = shownDoc.get(webContentsId);
      if (before && before !== opened.path) void versionsFor(folder)?.endSession(before);
      shownDoc.set(webContentsId, opened.path);
      docWatcher.watch(webContentsId, folder.path, opened.path, opened.hash);
      if (opened.mode === "editable") void versionsFor(folder)?.opened(opened.path, opened.text);
    } else docWatcher.stop(webContentsId);
    return opened;
  },
  "doc:save": async (request, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    const saved = await saveDoc(folder, request);
    if (saved.kind === "saved") {
      docWatcher.setHash(webContentsId, request.path, saved.hash);
      void versionsFor(folder)?.saved(request.path, request.text);
    }
    return saved;
  },
  "recovery:write": async ({ path: doc, text, saved }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder?.docs.includes(doc)) return { ok: false };
    await recovery.write(folder.path, doc, { text, saved });
    return { ok: true };
  },
  "recovery:clear": async ({ path: doc }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (folder) await recovery.clear(folder.path, doc);
    return { ok: Boolean(folder) };
  },
  "recovery:read": async ({ path: doc }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    return { entry: folder?.docs.includes(doc) ? await recovery.read(folder.path, doc) : null };
  },
  "journal:keep": async (entry, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder?.docs.includes(entry.path)) return { id: "" };
    return { id: (await journal.keep(folder.path, entry)).id };
  },
  "journal:list": async ({ path: doc }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    return { entries: folder ? await journal.list(folder.path, doc) : [] };
  },
  "journal:drop": async ({ id }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (folder) await journal.drop(folder.path, id);
    return { ok: Boolean(folder) };
  },
  "menu:popup": ({ items }, { webContentsId }) =>
    new Promise((resolve) => {
      const win = windows.get(webContentsId);
      if (!win) {
        resolve({ id: null });
        return;
      }
      let chosen: string | null = null;
      const build = (entries: MenuEntry[]): MenuItemConstructorOptions[] =>
        entries.map((item) =>
          "separator" in item
            ? { type: "separator" as const }
            : "submenu" in item
              ? { label: item.label, submenu: build(item.submenu) }
              : {
                  label: item.label,
                  enabled: item.enabled ?? true,
                  ...(item.checked === undefined
                    ? {}
                    : { type: "checkbox" as const, checked: item.checked }),
                  click: () => {
                    chosen = item.id;
                    resolve({ id: item.id });
                  },
                },
        );
      // Closing without a choice resolves null. On macOS the click can arrive
      // a moment after the close, so the close waits briefly for it.
      Menu.buildFromTemplate(build(items)).popup({
        window: win,
        callback: () => {
          setTimeout(() => {
            resolve({ id: chosen });
          }, 250);
        },
      });
    }),
  "base:read": async ({ target, from }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    return readEmbeddedBase(folder, target, from);
  },
  "settings:get": async (_request, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    return {
      sectionHistory: appSettings.get().sectionHistory,
      commitAnur: folder ? await commitsAnur(folder.path) : null,
    };
  },
  "settings:set": async ({ sectionHistory, commitAnur }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (sectionHistory !== undefined) await appSettings.set({ sectionHistory });
    if (commitAnur !== undefined && folder?.mode === "writable") {
      await setCommitsAnur(folder.path, commitAnur);
    }
    return {
      sectionHistory: appSettings.get().sectionHistory,
      commitAnur: folder ? await commitsAnur(folder.path) : null,
    };
  },
  "folder:search": async ({ query }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { matches: [], truncated: false, skipped: 0 };
    return searchFolder(folder, query);
  },
  "doc:create": async ({ path: requested }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    const made = await createDoc(folder, requested);
    if (made.kind === "failed") return made;
    const now = await folders.refresh(webContentsId);
    return now
      ? { kind: "created", path: made.path, folder: now }
      : { kind: "failed", reason: "The folder closed." };
  },
  "link:open-external": async ({ url }) => {
    // Only the web and mail: a link in a doc never runs anything on this Mac.
    if (!/^(https?:|mailto:)/i.test(url)) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  },
  "clipboard:write": async ({ text }) => {
    await systemClipboard.writeText(text);
    return { ok: true };
  },
  "doc:reveal": async ({ path: doc, how }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder?.docs.includes(doc)) return { ok: false };
    const file = path.join(folder.path, doc);
    if (how === "finder") {
      shell.showItemInFolder(file);
      return { ok: true };
    }
    return { ok: (await shell.openPath(file)) === "" };
  },
  "conflict:plan": async ({ copy }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    return planConflict(folder, copy);
  },
  "conflict:merge": async (request, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    if (folder.mode === "read-only") return { kind: "failed", reason: "This folder is read-only." };
    const result = await mergeConflict(folder, request, (file) => shell.trashItem(file));
    if (!result.ok) return { kind: "failed", reason: result.reason };
    const fresh = await folders.refresh(webContentsId);
    if (!fresh) return { kind: "failed", reason: "The folder closed during the merge." };
    const win = windows.get(webContentsId);
    if (win) send(win, "folder:changed", fresh);
    return { kind: "merged", folder: fresh };
  },
};

function registerIpc() {
  for (const channel of CHANNELS) {
    const run = guarded(channel, handlers[channel] as Handler<typeof channel>, (s) =>
      senders.isTrusted(s),
    );
    ipcMain.handle(channel, (event, raw) =>
      run({ webContentsId: event.sender.id, frameUrl: event.senderFrame?.url ?? null }, raw),
    );
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Anur",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(here, "..", "preload", "index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  const id = win.webContents.id;
  windows.set(id, win);
  senders.add(id);
  win.on("closed", () => {
    const folder = folders.current(id);
    const shown = shownDoc.get(id);
    if (folder && shown) void versionsFor(folder)?.endSession(shown);
    shownDoc.delete(id);
    windows.delete(id);
    docWatcher.stop(id);
    senders.remove(id);
    void folders.close(id);
  });

  // The window only ever shows Anur's own page; links open nowhere until
  // there is a rule for them.
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.once("ready-to-show", () => {
    win.show();
  });

  // Check runs mark the page with #check, which lets a probe reach the editor.
  const hash = isCheck ? "#check" : "";
  if (devUrl) void win.loadURL(devUrl + hash);
  else void win.loadFile(path.join(here, "..", "renderer", "index.html"), { hash: hash.slice(1) });
  return win;
}

function focusedOrNew(): BrowserWindow {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? createWindow();
}

/** For checks: ANUR_SCREENSHOT=<file.png> saves the first window once drawn, then quits. */
function screenshotThenQuit(win: BrowserWindow, file: string) {
  win.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      void (async () => {
        if (process.env.ANUR_SCREENSHOT_DRAG) {
          // Drag the left divider 120px right and the right divider 100px left,
          // or, with ANUR_SCREENSHOT_DRAG=narrow, both panels to their narrowest.
          const [w] = win.getContentSize();
          const drag = async (from: number, to: number) => {
            const y = 400;
            win.webContents.sendInputEvent({
              type: "mouseDown",
              x: from,
              y,
              button: "left",
              clickCount: 1,
            });
            for (let x = from; from < to ? x <= to : x >= to; x += from < to ? 20 : -20) {
              win.webContents.sendInputEvent({
                type: "mouseMove",
                x,
                y,
                modifiers: ["leftbuttondown"],
              });
              await new Promise((r) => setTimeout(r, 16));
            }
            win.webContents.sendInputEvent({
              type: "mouseUp",
              x: to,
              y,
              button: "left",
              clickCount: 1,
            });
          };
          const width = w ?? 1440;
          if (process.env.ANUR_SCREENSHOT_DRAG === "narrow") {
            await drag(48 + 260, 40);
            await drag(width - 300, width - 20);
          } else {
            await drag(48 + 260, 48 + 380);
            await drag(width - 300, width - 400);
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        const clicks = process.env.ANUR_SCREENSHOT_CLICK;
        if (clicks) {
          // Click buttons by the start of their visible text (or, for an icon, its label), in order, such as "Engineering,Archive,Old".
          for (const label of clicks.split(",")) {
            await win.webContents.executeJavaScript(
              `[...document.querySelectorAll("button, input[type=checkbox]")].find((b) => (b.textContent.trim() || b.getAttribute("aria-label") || "").startsWith(${JSON.stringify(label)}))?.click()`,
            );
            await new Promise((r) => setTimeout(r, 150));
          }
        }
        // ANUR_SCREENSHOT_TYPE types text into the page, at the start of the
        // line ANUR_SCREENSHOT_LINE names; ANUR_SCREENSHOT_KEYS then presses
        // keys such as "meta+alt+2,Tab". The quit that follows the screenshot
        // also checks that pending typing is saved before the window closes.
        const typed = process.env.ANUR_SCREENSHOT_TYPE;
        const keys = process.env.ANUR_SCREENSHOT_KEYS;
        if (typed !== undefined || keys) {
          // The line drawn on the page, or the table cell, whose text starts with
          // ANUR_SCREENSHOT_LINE; a cell gets focus with the caret at its end.
          const line = JSON.stringify(process.env.ANUR_SCREENSHOT_LINE ?? "");
          await win.webContents.executeJavaScript(
            `new Promise((done) => { document.querySelector(".cm-content")?.focus(); setTimeout(() => { const el = [...document.querySelectorAll(".cm-line, [data-row]")].find((l) => l.textContent.startsWith(${line})); if (el && el.dataset.row) el.focus(); else if (el) { const r = document.createRange(); r.setStart(el, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } setTimeout(done, 50); }, 100); })`,
          );
          await new Promise((r) => setTimeout(r, 100));
          // One keystroke per character, as typing is, so typing-only features react.
          for (const ch of typed ?? "") {
            win.webContents.sendInputEvent({ type: "char", keyCode: ch });
            await new Promise((r) => setTimeout(r, 15));
          }
          // Let anything typing opened, such as the insert menu, appear first.
          if (typed && keys) await new Promise((r) => setTimeout(r, 300));
          for (const combo of keys ? keys.split(",") : []) {
            const parts = combo.split("+");
            const keyCode = parts.pop() ?? "";
            const modifiers = parts as ("meta" | "alt" | "shift" | "control")[];
            win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
            win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
            await new Promise((r) => setTimeout(r, 80));
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        // ANUR_SCREENSHOT_MENU clicks a menu-bar item by its id, such as "insert-table".
        const menuItem = process.env.ANUR_SCREENSHOT_MENU;
        if (menuItem) {
          Menu.getApplicationMenu()?.getMenuItemById(menuItem)?.click();
          await new Promise((r) => setTimeout(r, 400));
        }
        // ANUR_SCREENSHOT_PROBE evaluates an expression in the page and prints it.
        const probe = process.env.ANUR_SCREENSHOT_PROBE;
        if (probe) {
          const result: unknown = await win.webContents.executeJavaScript(probe);
          console.log(`probe: ${JSON.stringify(result)}`);
        }
        // ANUR_SCREENSHOT_COPY copies the page's selection, as Edit → Copy does.
        if (process.env.ANUR_SCREENSHOT_COPY) {
          win.webContents.copy();
          await new Promise((r) => setTimeout(r, 300));
        }
        if (process.env.ANUR_SCREENSHOT_PALETTE) {
          win.webContents.sendInputEvent({ type: "keyDown", keyCode: "K", modifiers: ["meta"] });
          await new Promise((r) => setTimeout(r, 300));
        }
        const image = await win.webContents.capturePage();
        await writeFile(file, image.toPNG());
        app.quit();
      })();
    }, 1200);
  });
}

// One copy of Anur at a time; a second launch brings the first forward.
if (!isCheck && !app.requestSingleInstanceLock()) app.quit();

app.enableSandbox();
void app.whenReady().then(async () => {
  // Checks can set ANUR_CHECK_HOME, so a sample folder can stand in for one in iCloud.
  journal = new Journal(app.getPath("userData"));
  appSettings = new AppSettingsStore(app.getPath("userData"));
  await appSettings.load();
  device = await loadDeviceId(app.getPath("userData")).catch((e: unknown) => {
    console.error("Anur couldn't read this install's device ID:", e);
    return null;
  });
  recovery = new RecoveryStore(app.getPath("userData"));
  folders = new FolderService(
    app.getPath("userData"),
    isCheck ? (process.env.ANUR_CHECK_HOME ?? undefined) : undefined,
  );
  // No page in Anur needs the camera, microphone, location or notifications.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  registerIpc();
  // A built app takes its icon from its bundle; in dev, show the diamond in the Dock too.
  if (!app.isPackaged && process.platform === "darwin") {
    app.dock?.setIcon(path.join(here, "..", "..", "build", "icon.png"));
  }
  Menu.setApplicationMenu(
    buildMenu({
      openFolder: () => {
        void chooseFolder(focusedOrNew());
      },
      newWindow: () => {
        createWindow();
      },
      insert: (id) => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) send(win, "editor:insert", { id });
      },
      command: (command) => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) send(win, "app:command", { command });
      },
      isDev: Boolean(devUrl),
    }),
  );

  const win = createWindow();
  const shot = process.env.ANUR_SCREENSHOT;
  if (shot) screenshotThenQuit(win, shot);

  // Reopen a folder: ANUR_OPEN_FOLDER for checks, otherwise the last one opened.
  const reopen =
    process.env.ANUR_OPEN_FOLDER ??
    (isCheck ? undefined : (await readRecent(app.getPath("userData")))[0]);
  if (reopen) {
    win.webContents.once("did-finish-load", () => {
      void openFolderIn(win, reopen);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// Quitting ends every typing session first, so its versions are written (2.24).
let sessionsEnded = false;
app.on("will-quit", (event) => {
  if (!sessionsEnded && versions.size > 0) {
    event.preventDefault();
    sessionsEnded = true;
    void Promise.all([...versions.values()].map((v) => v.endAll())).finally(() => {
      app.quit();
    });
    return;
  }
  docWatcher.stopAll();
  void folders.closeAll();
});

// A window with unsaved typing holds its close until the save lands
// (the page's beforeunload), then closes itself; a quit carries on after it.
let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || quitting) app.quit();
});
