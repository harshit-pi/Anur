import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FORMAT_VERSION, PreviewPart, docsBefore } from "@anur/core";
import { AGENTS, type AgentId } from "../shared/agents.ts";
import type { SessionOption } from "../agent/protocol.ts";
import {
  BrowserWindow,
  ClipboardItem,
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
import { ClaudeSkill, claudeHome } from "./claude-skill/install.ts";
import { terminalHandler, writeTerminalFile } from "./claude-skill/terminal.ts";
import { findClaude, loginPath } from "../agent/find-claude.ts";
import { baseAsMarkdown } from "@anur/core";
import { readImage, saveImage } from "./folder/images.ts";
import { MapLayouts } from "./folder/map-layout.ts";
import { writeFileAtomic } from "../vault/anur-folder.ts";
import { createDoc, searchFolder } from "./folder/search.ts";
import {
  copyInto,
  createFolder,
  duplicateDoc,
  moveEntry,
  restoreEntry,
  trashEntry,
} from "./folder/file-ops.ts";
import { isInTrash, trashTelling } from "./folder/system-trash.ts";
import { FILES_TYPE, filePathsPlist, readFilePaths } from "./folder/finder-clipboard.ts";
import { FolderWatch } from "./folder/folder-watch.ts";
import { planLinkUpdates } from "./folder/link-updates.ts";
import { openDoc } from "./folder/open-doc.ts";
import { DocWatcher } from "./folder/doc-watcher.ts";
import { Journal } from "./folder/journal.ts";
import { SectionVersions, lastSavedIn } from "./folder/versions.ts";
import { loadDeviceId } from "../device/device-id.ts";
import { RecoveryStore } from "./folder/recovery.ts";
import { saveDoc } from "./folder/save-doc.ts";
import { readRecent } from "./folder/recent.ts";
import { makeStartFolder } from "./folder/new-folder.ts";
import { guarded, trustedSenders, type Handler } from "./ipc.ts";
import { buildMenu } from "./menu.ts";
import { AgentHub, hookEntry, hostEntry } from "./threads/hub.ts";
import { AgentChoices } from "./threads/agent-choices.ts";
import { AnurSocket } from "./threads/anur-socket.ts";
import { Threads } from "./threads/threads.ts";

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
/** Section IDs and versions (2.21), one writer per open folder; none for a read-only folder. */
const versions = new Map<string, SectionVersions>();
function versionsFor(folder: FolderState): SectionVersions | null {
  if (!device || folder.mode !== "writable") return null;
  let v = versions.get(folder.path);
  if (!v) {
    v = new SectionVersions(
      folder.path,
      device,
      (e) => {
        console.error("Anur couldn't record section versions:", e);
      },
      lastSavedIn(app.getPath("userData"), folder.path),
      undefined,
      () => appSettings.get().sectionHistory,
    );
    versions.set(folder.path, v);
  }
  return v;
}
/** The agent host, shared by every window; started when a thread first needs it (3.1). */
let choices: AgentChoices;
const hub = new AgentHub(
  hostEntry(here),
  (status) => {
    for (const win of windows.values()) send(win, "agent:status", status);
  },
  (agent, options) => {
    rememberChoices(agent, options);
  },
  (e) => {
    for (const win of windows.values()) send(win, "agent:auth", e);
  },
);
/** An agent's choices changed: keep them, and tell every window. */
function rememberChoices(agent: AgentId, options: SessionOption[]) {
  if (options.length === 0) return;
  void choices.set(agent, options);
  for (const win of windows.values()) send(win, "agent:options", { agent, options });
}
/** The socket Anur's MCP tools reach it over, in a folder only this account can open (3.12). */
const anurSocket = new AnurSocket(mkdtempSync(path.join(tmpdir(), "anur-")));
void anurSocket.start().catch((e: unknown) => {
  console.error("Anur's tool socket didn't start; threads run without Anur's tools:", e);
});
/** Anur in the person's Claude Code (group 6); set up once the app is ready. */
let claudeSkill: ClaudeSkill | null = null;

/** The front window, and the folder it shows. */
function front() {
  const win = BrowserWindow.getFocusedWindow() ?? [...windows.values()][0] ?? null;
  const folder = win ? folders.current(win.webContents.id) : null;
  return win && folder ? { win, folder } : null;
}

/**
 * Group 6: the terminal token and its file (6.4), the tools an agent in a
 * terminal reaches (6.5 to 6.9), and the check of the installed skill on
 * every launch (6.3).
 */
async function startClaudeSkill(): Promise<void> {
  const support = app.getPath("userData");
  const terminalFile = path.join(support, "agent", "terminal.json");
  claudeSkill = new ClaudeSkill({
    stateFile: path.join(support, "claude-skill.json"),
    ...claudeHome(),
    claude: async () => findClaude(await loginPath()),
    entry: {
      type: "stdio",
      command: process.execPath,
      args: [path.join(here, "mcp-server.js")],
      env: { ELECTRON_RUN_AS_NODE: "1", ANUR_TERMINAL: terminalFile },
    },
  });
  const t = (webContentsId: number) => {
    const folder = folders.current(webContentsId);
    return folder ? threadsFor(folder) : null;
  };
  const token = anurSocket.issue(
    terminalHandler({
      front: () => {
        const f = front();
        return f
          ? { folder: f.folder.path, docs: f.folder.docs, webContentsId: f.win.webContents.id }
          : null;
      },
      outline: async (_f, rel, text) => {
        const at = front();
        return at ? ((await t(at.win.webContents.id)?.outlineOf(rel, text)) ?? null) : null;
      },
      bundle: async (_f, rel, text, section) => {
        const at = front();
        return at ? ((await t(at.win.webContents.id)?.bundleOf(rel, text, section)) ?? null) : null;
      },
      threads: async (_f, rel, text) => {
        const at = front();
        return at ? ((await t(at.win.webContents.id)?.threadsOf(rel, text)) ?? null) : null;
      },
      propose: async (_f, rel, text, section, body, summary) => {
        const at = front();
        return at
          ? ((await t(at.win.webContents.id)?.proposeFromTerminal(
              rel,
              text,
              section,
              body,
              summary,
            )) ?? null)
          : null;
      },
      keepChat: async (_f, rel, text, chat) => {
        const at = front();
        return at ? ((await t(at.win.webContents.id)?.keepChat(rel, text, chat)) ?? null) : null;
      },
      create: async (webContentsId, name, markdown) => {
        const folder = folders.current(webContentsId);
        if (!folder) return { error: "Anur has no folder open." };
        const made = await createDoc(folder, name);
        if (made.kind === "failed") return { error: made.reason };
        await writeFileAtomic(path.join(folder.path, made.path), markdown);
        threadsFor(folder)?.ownWrite(made.path, markdown);
        const now = await folders.refresh(webContentsId);
        const win = windows.get(webContentsId);
        if (win && now) send(win, "folder:changed", now);
        return { path: made.path };
      },
      open: (webContentsId, rel, section) => {
        const win = windows.get(webContentsId);
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();
        send(win, "app:open-doc", { path: rel, section });
      },
    }),
  );
  try {
    await anurSocket.start();
    await writeTerminalFile(terminalFile, anurSocket.path, token);
    if (isCheck) console.log(`terminal-file: ${terminalFile}`);
  } catch (e) {
    console.error("Anur couldn't open its tools to a terminal:", e);
  }
  const repaired = await claudeSkill.check().catch(() => []);
  if (repaired.length > 0)
    console.log(`Anur brought its Claude Code skill up to date: ${repaired.join(", ")}.`);
}

/** Agents whose choices were read this run; once per run is enough. */
const probed = new Set<AgentId>();
/** Each folder's threads, so a reply reaches the windows showing that folder. */
const threads = new Map<string, Threads>();
function threadsFor(folder: FolderState): Threads | null {
  const ids = versionsFor(folder);
  if (!device || !ids) return null;
  let t = threads.get(folder.path);
  if (!t) {
    t = new Threads({
      folder: folder.path,
      device,
      appSupport: app.getPath("userData"),
      hub,
      hookScript: hookEntry(here),
      node: process.execPath,
      locate: (rel, text) => ids.locate(rel, text),
      emit: (event) => {
        for (const [id, win] of windows) {
          if (folders.current(id)?.path === folder.path) send(win, "thread:event", event);
        }
      },
      defaultAgent: () => appSettings.get().defaultAgent,
      rememberOptions: rememberChoices,
      mcp: { socket: anurSocket, script: path.join(here, "mcp-server.js") },
      autoApply: () => appSettings.get().autoApply,
      isOpen: (rel) =>
        [...shownDoc.entries()].some(
          ([win, doc]) => doc === rel && folders.current(win)?.path === folder.path,
        ),
      applied: async (rel, text, section, applied, thread) => {
        const at = await ids.locate(rel, text);
        const i = at ? at.ids.indexOf(section) : -1;
        if (!at || i < 0) return;
        await ids.applied(
          rel,
          section,
          applied,
          at.tree.sections[i]?.path ?? [],
          `p${thread}`,
          thread,
        );
      },
      baseTables: async (rel, target) => {
        const r = await readEmbeddedBase(folder, target, rel);
        if (r.kind !== "base") return null;
        const views = r.view ? r.views.filter((v) => v.name === r.view) : r.views;
        const tables = (views.length > 0 ? views : r.views).map((v) =>
          r.views.length > 1 && !r.view
            ? `**${v.name}**\n\n${baseAsMarkdown(v)}`
            : baseAsMarkdown(v),
        );
        return [`The base ${r.path}, as a table:`, "", ...tables.flatMap((t) => [t, ""])]
          .join("\n")
          .trimEnd();
      },
      previewsChanged: (rel) => {
        for (const [id, win] of windows) {
          if (folders.current(id)?.path === folder.path)
            send(win, "preview:changed", { path: rel });
        }
      },
    });
    threads.set(folder.path, t);
  }
  return t;
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

/** Files added, moved or removed outside Anur, as in Finder: the files panel catches up. */
const folderWatch = new FolderWatch((windowId) => {
  void (async () => {
    const before = folders.current(windowId);
    const now = await folders.refresh(windowId);
    const win = windows.get(windowId);
    if (!before || !now || !win) return;
    const lists = (f: FolderState) => JSON.stringify([f.docs, f.folders, f.files, f.offloaded]);
    if (lists(before) !== lists(now)) send(win, "folder:changed", now);
  })();
});

/** The window's open doc is moving or going: stop watching it, so it isn't reported gone. */
function letGoOf(windowId: number, docs: readonly string[]) {
  const shown = shownDoc.get(windowId);
  if (shown && docs.includes(shown)) {
    docWatcher.stop(windowId);
    shownDoc.delete(windowId);
  }
}

function send<E extends EventName>(win: BrowserWindow, event: E, payload: EventPayload<E>) {
  if (!win.isDestroyed()) win.webContents.send(event, payload);
}

/** Open a folder: in its own window if it is open already, in a new window if this one has a folder. */
async function openFolderIn(win: BrowserWindow, folder: string): Promise<OpenOutcome> {
  let target = win;
  if (folders.current(win.webContents.id)) target = createWindow();
  const outcome = await folders.open(target.webContents.id, folder);
  if (outcome.kind === "opened") {
    folderWatch.start(target.webContents.id, outcome.folder.path);
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

/** "New Folder…": name it and pick where in one sheet; Anur makes it and opens it. */
async function newFolder(win: BrowserWindow): Promise<OpenOutcome | { kind: "cancelled" }> {
  const picked = await dialog.showSaveDialog(win, {
    title: "New folder",
    message: "Name the folder your docs will live in.",
    nameFieldLabel: "Folder name:",
    buttonLabel: "Create",
    defaultPath: path.join(app.getPath("documents"), "Docs"),
    properties: ["createDirectory"],
  });
  if (picked.canceled || !picked.filePath) return { kind: "cancelled" };
  const made = await makeStartFolder(picked.filePath);
  const outcome: OpenOutcome =
    made.kind === "made"
      ? await openFolderIn(win, picked.filePath)
      : { kind: "refused", reason: made.reason };
  if (outcome.kind === "refused") {
    await dialog.showMessageBox(win, {
      type: "warning",
      message: "Anur can't make this folder",
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
  "folder:new": async (_req, { webContentsId }) => {
    const win = windows.get(webContentsId);
    if (!win) return { kind: "cancelled" };
    const outcome = await newFolder(win);
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
      // Anur's own save: never flagged as a change made during a thread's turn.
      threadsFor(folder)?.ownWrite(request.path, request.text);
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
  "image:read": async ({ target, from }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    return readImage(folder.path, target, from);
  },
  "image:save": async ({ from, name, type, data }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || folder.mode !== "writable" || !folder.docs.includes(from))
      return { kind: "failed", reason: "Images can be kept only in a folder Anur can write to." };
    const saved = await saveImage(folder.path, from, name, type, Buffer.from(data, "base64"));
    if (saved.kind === "saved") {
      const fresh = await folders.refresh(webContentsId);
      const win = windows.get(webContentsId);
      if (win && fresh) send(win, "folder:changed", fresh);
    }
    return saved;
  },
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
      defaultAgent: appSettings.get().defaultAgent,
      autoApply: appSettings.get().autoApply,
    };
  },
  "settings:set": async (
    { sectionHistory, commitAnur, defaultAgent, autoApply },
    { webContentsId },
  ) => {
    const folder = folders.current(webContentsId);
    if (sectionHistory !== undefined) await appSettings.set({ sectionHistory });
    if (defaultAgent !== undefined) await appSettings.set({ defaultAgent });
    if (autoApply !== undefined) await appSettings.set({ autoApply });
    if (commitAnur !== undefined && folder?.mode === "writable") {
      await setCommitsAnur(folder.path, commitAnur);
    }
    return {
      sectionHistory: appSettings.get().sectionHistory,
      commitAnur: folder ? await commitsAnur(folder.path) : null,
      defaultAgent: appSettings.get().defaultAgent,
      autoApply: appSettings.get().autoApply,
    };
  },
  "thread:rename": async ({ thread, path: rel, text, title }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    return { ok: t ? await t.rename(rel, text, thread, title) : false };
  },
  "thread:auto-undo": async ({ thread, id }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    return t ? t.autoUndoFor(thread, id) : { kind: "refused", reason: "No folder is open." };
  },
  "thread:auto-used": async ({ thread, path: rel, text, section }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    await t?.noteAutoUsed(rel, text, thread, section);
    return {};
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
    const madeText = await readFile(path.join(folder.path, made.path), "utf8").catch(() => null);
    if (madeText !== null) threadsFor(folder)?.ownWrite(made.path, madeText);
    const now = await folders.refresh(webContentsId);
    return now
      ? { kind: "created", path: made.path, folder: now }
      : { kind: "failed", reason: "The folder closed." };
  },
  "folder:create": async ({ path: requested }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    const made = await createFolder(folder, requested);
    if (made.kind === "failed") return made;
    const now = await folders.refresh(webContentsId);
    return now ? { ...made, folder: now } : { kind: "failed", reason: "The folder closed." };
  },
  "file:move": async ({ from, to }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    const moved = await moveEntry(folder, from, to);
    if (moved.kind === "failed") return moved;
    letGoOf(
      webContentsId,
      moved.docs.map((d) => d.from),
    );
    await versionsFor(folder)?.moved(moved.docs.filter((d) => /\.md$/i.test(d.to)));
    const now = await folders.refresh(webContentsId);
    return now ? { ...moved, folder: now } : { kind: "failed", reason: "The folder closed." };
  },
  "file:duplicate": async ({ path: requested }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    const made = await duplicateDoc(folder, requested);
    if (made.kind === "failed") return made;
    const now = await folders.refresh(webContentsId);
    return now ? { ...made, folder: now } : { kind: "failed", reason: "The folder closed." };
  },
  "file:trash": async ({ path: requested }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    const gone = await trashEntry(folder, requested, async (full) => {
      const place = await trashTelling(full);
      if (place) return place;
      await shell.trashItem(full);
      return null;
    });
    if (gone.kind === "failed") return gone;
    letGoOf(webContentsId, gone.docs);
    const now = await folders.refresh(webContentsId);
    return now ? { ...gone, folder: now } : { kind: "failed", reason: "The folder closed." };
  },
  "file:restore": async ({ path: requested, trashed }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    const back = await restoreEntry(folder, requested, trashed, isInTrash);
    if (back.kind === "failed") return back;
    const now = await folders.refresh(webContentsId);
    return now ? { ...back, folder: now } : { kind: "failed", reason: "The folder closed." };
  },
  "links:plan": async ({ moves }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { docs: 0, links: 0 };
    const changes = await planLinkUpdates(folder, moves);
    return { docs: changes.length, links: changes.reduce((n, c) => n + c.links, 0) };
  },
  "links:update": async ({ moves }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || folder.mode !== "writable") return { docs: 0, links: 0, skipped: 0 };
    const changes = await planLinkUpdates(folder, moves);
    let docs = 0;
    let links = 0;
    let skipped = 0;
    const all = [...folder.docs, ...folder.files];
    const before = docsBefore(all, moves);
    for (const c of changes) {
      // An open doc is written by its page, so typing not yet saved stays and ⌘Z undoes it.
      const pages = [...shownDoc].filter(
        ([win, rel]) => rel === c.rel && folders.current(win)?.path === folder.path,
      );
      if (pages.length > 0) {
        for (const [win] of pages) {
          const w = windows.get(win);
          if (w)
            send(w, "links:rewrite", {
              path: c.rel,
              was: c.was,
              moves: [...moves],
              before,
              after: all,
            });
        }
      } else {
        const full = path.join(folder.path, c.rel);
        // Changed since it was read: leave it rather than write over someone's edit.
        if ((await readFile(full, "utf8").catch(() => null)) !== c.text) {
          skipped++;
          continue;
        }
        await writeFileAtomic(full, c.next);
        void versionsFor(folder)?.wroteClosed(c.rel, c.next);
        threadsFor(folder)?.ownWrite(c.rel, c.next);
      }
      docs++;
      links += c.links;
    }
    return { docs, links, skipped };
  },
  "link:open-external": async ({ url }) => {
    // Only the web and mail: a link in a doc never runs anything on this Mac.
    if (!/^(https?:|mailto:)/i.test(url)) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  },
  "clipboard:read-files": async () => {
    // Finder puts each copied file on the clipboard as an item of its own.
    const paths = new Set<string>();
    for (const item of await systemClipboard.read()) {
      const text = async (type: string) =>
        item.types.includes(type) ? ((await item.getType(type)) as Blob).text() : "";
      for (const p of readFilePaths(await text(FILES_TYPE), await text("text/uri-list")))
        paths.add(p);
    }
    return { paths: [...paths] };
  },
  "clipboard:write-files": async ({ paths }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { ok: false };
    const known = new Set([...folder.docs, ...folder.files, ...folder.folders]);
    const full = paths.filter((p) => known.has(p)).map((p) => path.join(folder.path, p));
    if (full.length === 0) return { ok: false };
    await systemClipboard.write([
      new ClipboardItem({ [FILES_TYPE]: filePathsPlist(full), "text/plain": full.join("\n") }),
    ]);
    return { ok: true };
  },
  "file:import": async ({ sources, into }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    const copied = await copyInto(folder, sources, into);
    if (copied.kind === "failed") return copied;
    const now = await folders.refresh(webContentsId);
    return now ? { ...copied, folder: now } : { kind: "failed", reason: "The folder closed." };
  },
  "clipboard:write": async ({ text }) => {
    await systemClipboard.writeText(text);
    return { ok: true };
  },
  "doc:reveal": async ({ path: doc, how }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || ![...folder.docs, ...folder.files, ...folder.folders].includes(doc))
      return { ok: false };
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
  "map:read": async ({ path: doc, text }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const ids = folder ? versionsFor(folder) : null;
    if (!folder || !ids || !device || !folder.docs.includes(doc)) return { ids: [], positions: {} };
    const at = await ids.locate(doc, text);
    if (!at) return { ids: [], positions: {} };
    return { ids: at.ids, positions: await new MapLayouts(folder.path, device).read(at.doc) };
  },
  "map:save": async ({ path: doc, text, positions }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const ids = folder ? versionsFor(folder) : null;
    if (!folder || !ids || !device || !folder.docs.includes(doc)) return { ok: false };
    const at = await ids.locate(doc, text);
    if (!at) return { ok: false };
    await new MapLayouts(folder.path, device).write(at.doc, positions);
    return { ok: true };
  },
  "agent:status": async ({ connect, agent }) => {
    const id = agent ?? appSettings.get().defaultAgent;
    return connect ? hub.connect(id) : hub.status(id);
  },
  "thread:list": async ({ path: doc, text }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    return { threads: t ? await t.list(doc, text) : [] };
  },
  "agent:auth": ({ agent }) => {
    if (AGENTS[agent].runsThreads) hub.send({ type: "auth", agent });
    return { agent, auth: hub.auth(agent), signIn: hub.signIn(agent) };
  },
  "agent:sign-in": ({ agent, method }) => {
    hub.clearSignIn(agent);
    hub.send({ type: "sign-in", agent, method });
    return {};
  },
  "agent:sign-in-cancel": ({ agent }) => {
    hub.send({ type: "sign-in-cancel", agent });
    return {};
  },
  "agent:options": ({ agent }, { webContentsId }) => {
    if (!probed.has(agent) && AGENTS[agent].runsThreads) {
      probed.add(agent);
      hub.send({
        type: "probe",
        agent,
        cwd: folders.current(webContentsId)?.path ?? app.getPath("home"),
      });
    }
    return { options: choices.get(agent) };
  },
  "thread:start": async (
    { path: doc, text, section, message, agent, options },
    { webContentsId },
  ) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!folder || !t || !folder.docs.includes(doc))
      return { kind: "refused", reason: "Threads need a doc in a folder Anur can write to." };
    return t.start(doc, text, section, message, agent, options);
  },
  "thread:send": async ({ thread, path: doc, text, message }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!folder || !t || !folder.docs.includes(doc))
      return { kind: "refused", reason: "Threads need a doc in a folder Anur can write to." };
    return t.send(thread, doc, text, message);
  },
  "preview:list": async ({ path: doc, text }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    return { previews: t ? await t.listPreviews(doc, text) : [] };
  },
  "preview:update": async ({ path: doc, text, thread, parts }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (t && folder?.docs.includes(doc))
      await t.updatePreview(doc, text, thread, PreviewPart.array().parse(parts));
    return {};
  },
  "preview:unsaved": async ({ path: doc, text, proposed }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!folder || !t || !folder.docs.includes(doc)) return { ok: false };
    return { ok: await t.keepUnsaved(doc, text, proposed) };
  },
  "preview:apply": async ({ path: doc, text, thread, section, applied }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const ids = folder ? versionsFor(folder) : null;
    if (!folder || !ids || !folder.docs.includes(doc))
      return { kind: "refused", reason: "This folder is read-only." };
    const at = await ids.locate(doc, text);
    const i = at ? at.ids.indexOf(section as never) : -1;
    if (!at || i < 0) return { kind: "refused", reason: "That section is gone." };
    await ids.applied(
      doc,
      at.ids[i] as never,
      applied,
      at.tree.sections[i]?.path ?? [],
      `p${thread}`,
      thread,
    );
    return { kind: "ok" };
  },
  "thread:agent": ({ thread, agent }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (folder) threadsFor(folder)?.setAgent(thread, agent);
    return {};
  },
  "thread:option": ({ thread, id, value }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (folder) threadsFor(folder)?.setOption(thread, id, value);
    return {};
  },
  "inputs:list": async ({ path: rel, text, section }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!t) return { inputs: [] };
    const list = await t.listInputs(rel, text, section.index, section.path);
    return {
      inputs: list.map((c) => ({
        id: c.id,
        thread: c.thread,
        source: c.source,
        label: c.label,
        trust: c.trust,
      })),
    };
  },
  "inputs:remove": async ({ path: rel, text, thread, input }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    return { ok: t ? await t.removeInput(rel, text, thread, input) : false };
  },
  "skill:status": async () =>
    claudeSkill
      ? claudeSkill.status()
      : { added: false, dismissed: false, claude: false, current: false },
  "skill:act": async ({ action }) => {
    if (!claudeSkill) return { kind: "failed", reason: "Anur is still starting." };
    try {
      if (action === "add" || action === "update") await claudeSkill.add();
      else if (action === "remove") await claudeSkill.remove();
      else await claudeSkill.dismiss();
      return { kind: "done" };
    } catch (e) {
      return { kind: "failed", reason: e instanceof Error ? e.message : String(e) };
    }
  },
  "thread:explore-option": async ({ thread, path: rel, text, option }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!folder || !t || !folder.docs.includes(rel))
      return { kind: "refused", reason: "Threads need a doc in a folder Anur can write to." };
    return t.exploreOption(rel, text, thread, option);
  },
  "thread:use-option": async ({ thread, path: rel, text, option, how }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!t) return { ok: false };
    return { ok: await t.useOption(rel, text, thread, option, how) };
  },
  "thread:revert": async ({ thread, id }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!folder || !t) return { kind: "refused", reason: "No folder Anur can write to is open." };
    const r = t.revertFor(thread, id);
    if (r.kind === "refused") return r;
    const full = path.join(folder.path, r.rel);
    const now = await readFile(full, "utf8").catch(() => null);
    if (now !== r.after)
      return {
        kind: "refused",
        reason: `${r.rel} has changed again since. Open it and use its History to go back.`,
      };
    // An open doc is written by its page, so Undo covers the Revert; a closed one by main.
    const pages = [...shownDoc].filter(
      ([win, rel]) => rel === r.rel && folders.current(win)?.path === folder.path,
    );
    if (pages.length > 0) {
      for (const [win] of pages) {
        const w = windows.get(win);
        if (w) send(w, "doc:replace", { path: r.rel, text: r.before });
      }
    } else {
      await writeFileAtomic(full, r.before);
    }
    t.reverted(thread, id);
    return { kind: "reverted" };
  },
  "thread:stop": ({ thread }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (folder) threadsFor(folder)?.stop(thread);
    return {};
  },
  "thread:permission": ({ request, option }) => {
    hub.send({ type: "permission", request, option });
    return {};
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
    folderWatch.stop(id);
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
  choices = new AgentChoices(app.getPath("userData"));
  await choices.load();
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
  void startClaudeSkill();
  // A built app takes its icon from its bundle; in dev, show the diamond in the Dock too.
  if (!app.isPackaged && process.platform === "darwin") {
    app.dock?.setIcon(path.join(here, "..", "..", "build", "icon.png"));
  }
  Menu.setApplicationMenu(
    buildMenu({
      openFolder: () => {
        void chooseFolder(focusedOrNew());
      },
      newFolder: () => {
        void newFolder(focusedOrNew());
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
app.on("will-quit", (event) => {
  if (cleanedUp) return;
  // Clean up once, then exit: a second app.quit() from inside will-quit
  // isn't always honoured, which left the app running after a quit.
  event.preventDefault();
  cleanedUp = true;
  const cleanup = async () => {
    await Promise.all([...versions.values()].map((v) => v.endAll()));
    docWatcher.stopAll();
    hub.stop();
    anurSocket.close();
    await Promise.all([...threads.values()].map((t) => t.close()));
    await folders.closeAll();
  };
  // Never more than a few seconds: a stuck write mustn't keep the app open.
  void Promise.race([cleanup(), new Promise((r) => setTimeout(r, 4000))])
    .catch((e: unknown) => {
      console.error("Anur couldn't finish cleaning up before quitting:", e);
    })
    .finally(() => {
      app.exit(0);
    });
});
let cleanedUp = false;

// A window with unsaved typing holds its close until the save lands
// (the page's beforeunload), then closes itself; a quit carries on after it.
let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || quitting) app.quit();
});
