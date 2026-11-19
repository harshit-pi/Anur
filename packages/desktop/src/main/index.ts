import { mkdtempSync, mkdirSync } from "node:fs";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FORMAT_VERSION, PreviewPart, docsBefore, subtreeText } from "@anur/core";
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
import { fetchOffloaded } from "./folder/offloaded.ts";
import { keepAnurCopiesIn } from "../vault/anur-copy.ts";
import { mergeConflict, planConflict } from "./folder/conflicts.ts";
import { FolderService, type OpenOutcome } from "./folder/folder-service.ts";
import { readEmbeddedBase } from "./folder/bases.ts";
import { emptyDrawing, findDrawing, sceneOf, withScene } from "./drawings/drawing-file.ts";
import { listDocs } from "./folder/list-docs.ts";
import { ClaudeSkill, claudeHome } from "./claude-skill/install.ts";
import { terminalHandler, writeTerminalFile } from "./claude-skill/terminal.ts";
import { findClaude, loginPath } from "../agent/find-claude.ts";
import { baseAsMarkdown } from "@anur/core";
import { readImage, saveImage } from "./folder/images.ts";
import { MapInk } from "./folder/map-ink.ts";
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
import { agentMemoryMb } from "./threads/agent-memory.ts";
import { docFromText, obsidianVaults, resolveIncoming } from "./folder/incoming.ts";
import { planLinkUpdates } from "./folder/link-updates.ts";
import { openDoc } from "./folder/open-doc.ts";
import { DocWatcher } from "./folder/doc-watcher.ts";
import { Journal } from "./folder/journal.ts";
import { SectionVersions, lastSavedIn } from "./folder/versions.ts";
import { sectionCommits } from "./folder/git-history.ts";
import { suggestMatch } from "./folder/orphans.ts";
import { personName } from "./folder/people.ts";
import { CommittedDecisions } from "./committed-decisions.ts";
import { publicRepoFor } from "./public-repo.ts";
import { PluginHost, PluginRefused } from "@anur/core";
import { FIRST_PARTY, pluginById } from "../plugins/index.ts";
import {
  devicesStillOpen,
  namesOf,
  noteName,
  noteOpened,
  noteQuit,
  removeSnapshots,
  storageOf,
  unusedAttachments,
  unusedSnapshots,
} from "./folder/storage.ts";
import { SnapshotStore } from "../vault/snapshot-store.ts";
import { loadDeviceId } from "../device/device-id.ts";
import { RecoveryStore } from "./folder/recovery.ts";
import { saveDoc } from "./folder/save-doc.ts";
import { readRecent } from "./folder/recent.ts";
import { makeStartFolder } from "./folder/new-folder.ts";
import { guarded, trustedSenders, type Handler } from "./ipc.ts";
import { buildMenu } from "./menu.ts";
import {
  BUNDLE_ID,
  DEV_BUNDLE_ID,
  OpenerOffer,
  makeMarkdownOpener,
  markdownOpener,
} from "./default-opener.ts";
import {
  checkNow,
  download,
  restartToUpdate,
  setAuto,
  startUpdates,
  showForCheck,
  updateState,
} from "./updater.ts";
import { folderFor } from "./open-file.ts";
import { offerMoveToApplications } from "./move-to-applications.ts";
import { AgentHub, hookEntry, hostEntry } from "./threads/hub.ts";
import { IndexProcess, indexEntry } from "./index-process/client.ts";
import type { FolderRead } from "./index-process/protocol.ts";
import { loadRead, saveRead } from "./system-saved.ts";
import { TaskHooks } from "./claude-plugin/task-hooks.ts";
import { ReportWatch, listReports, readReport } from "./task-reports.ts";
import { codeRepos, looksLikeCode } from "./engineering-offer.ts";
import { SystemReview } from "./system-review.ts";
import {
  appendReview,
  excludedRepos,
  findRepoDirs,
  findRepos,
  includedRepoDirs,
  readReview,
  reviewState,
} from "@anur/system";
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

// Two apps from one code: Anur, the signed release people install, and
// Anur Dev, what `pnpm dev` and local builds run. Only the name, profile,
// bundle id and updates differ. Anur's profile is "Anur Desktop", where it
// has always been; Anur Dev keeps its own, so it never touches Anur's data.
// Checks run in a throwaway profile.
const isRelease = app.isPackaged && app.getName() === "Anur";
app.setName(isRelease ? "Anur" : "Anur Dev");
const sharedProfile = path.join(app.getPath("appData"), "Anur Desktop");
app.setPath(
  "userData",
  isCheck
    ? // ANUR_CHECK_PROFILE lets two check runs share one, to test what is remembered.
      (process.env.ANUR_CHECK_PROFILE ?? mkdtempSync(path.join(tmpdir(), "anur-check-")))
    : isRelease
      ? sharedProfile
      : path.join(app.getPath("appData"), "Anur Dev"),
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
      () => appSettings.get().features.history,
    );
    versions.set(folder.path, v);
  }
  return v;
}
/** The index process, where plugins read folders; started when first asked (group 20). */
/**
 * The last read of each folder's system, so the System tab opens at once:
 * kept until a watcher sees a change or the person's review changes.
 */
const systemReads = new Map<string, { plugins: string; read: Promise<FolderRead> }>();
/** Tell a folder's windows to read the system again. */
const systemNotify = (changed: string) => {
  for (const win of windows.values())
    if (folders.current(win.webContents.id)?.path === changed) send(win, "system:changed", {});
};
const systemChanged = (changed: string) => {
  systemReads.delete(changed);
  systemNotify(changed);
};
const indexProcess = new IndexProcess(indexEntry(here), systemChanged);
/** New task reports in a folder reach its windows (group 21). */
const reportWatch = new ReportWatch((changed) => {
  for (const win of windows.values())
    if (folders.current(win.webContents.id)?.path === changed) send(win, "tasks:changed", {});
});
// A low disk makes macOS offload iCloud files again: fetch open folders' files back now and then.
setInterval(() => {
  for (const id of windows.keys()) {
    const f = folders.current(id);
    if (f) void fetchOffloaded(f.path).catch(() => undefined);
  }
}, 10 * 60_000).unref();
/** Claude's names for the system's groups, asked on the person's own agent (20.6). */
const systemReview = new SystemReview(systemChanged);
// This Mac's copies of iCloud folders' .anur files, read when macOS has offloaded the files.
keepAnurCopiesIn(path.join(app.getPath("userData"), "anur-copies"));
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
/** The `anur` Claude Code plugin with the task hooks (group 21). */
let taskHooks: TaskHooks | null = null;
/** Whether the person turned down making Anur the opener for Markdown files. */
const openerOffer = () => new OpenerOffer(app.getPath("userData"));

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
  taskHooks = new TaskHooks({
    dir: path.join(support, "claude-plugin"),
    stateFile: path.join(support, "task-hooks.json"),
    claude: async () => findClaude(await loginPath()),
    node: process.execPath,
    cli: path.join(here, "system-cli.js"),
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
      search: async (words) => {
        const at = front();
        const threads = at ? t(at.win.webContents.id) : null;
        return threads
          ? threads.searchSectionsReport(words)
          : { error: "Anur has no folder open." };
      },
      links: async (_f, rel, text, section) => {
        const at = front();
        const threads = at ? t(at.win.webContents.id) : null;
        return threads
          ? threads.linksReport(rel, text, section)
          : { error: "Anur has no folder open." };
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
  const hooksRepaired = await taskHooks.check().catch(() => []);
  if (hooksRepaired.length > 0)
    console.log(`Anur brought its task hooks up to date: ${hooksRepaired.join(", ")}.`);
  const repaired = await claudeSkill.check().catch(() => []);
  if (repaired.length > 0)
    console.log(`Anur brought its Claude Code skill up to date: ${repaired.join(", ")}.`);
}

/** Agents whose choices were read this run; once per run is enough. */
const probed = new Set<AgentId>();
const probeFolder = () => {
  const dir = path.join(app.getPath("userData"), "agent", "empty");
  mkdirSync(dir, { recursive: true });
  return dir;
};
/** Each folder's threads, so a reply reaches the windows showing that folder. */
const threads = new Map<string, Threads>();
/** The plugins switched on for a folder, in Anur's own order (group 19). */
function pluginsOn(folderPath: string): string[] {
  const on = appSettings.get().plugins[folderPath] ?? [];
  return FIRST_PARTY.map((p) => p.manifest.id).filter((id) => on.includes(id));
}

/** Main's plugin host for each folder: it keeps main's points (context providers, surfaces). */
const pluginHosts = new Map<string, PluginHost>();

async function syncPlugins(folderPath: string): Promise<PluginHost> {
  let host = pluginHosts.get(folderPath);
  if (!host) {
    host = new PluginHost("main");
    pluginHosts.set(folderPath, host);
  }
  const want = new Set(pluginsOn(folderPath));
  for (const p of host.plugins()) if (!want.has(p.manifest.id)) await host.unload(p.manifest.id);
  const have = new Set(host.plugins().map((p) => p.manifest.id));
  for (const id of want) {
    const p = pluginById(id);
    if (p && !have.has(id))
      await host.load(p).catch((e: unknown) => {
        if (e instanceof PluginRefused) console.error(`Anur couldn't load ${id}:`, e.message);
        else throw e;
      });
  }
  return host;
}

async function pluginHostFor(folderPath: string): Promise<PluginHost> {
  return pluginHosts.get(folderPath) ?? syncPlugins(folderPath);
}

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
      committed: new CommittedDecisions(folder.path, device),
      emit: (event) => {
        for (const [id, win] of windows) {
          if (folders.current(id)?.path === folder.path) send(win, "thread:event", event);
        }
      },
      defaultAgent: () => appSettings.get().defaultAgent,
      rememberOptions: rememberChoices,
      knownOptions: (agent) => choices.get(agent),
      mcp: { socket: anurSocket, script: path.join(here, "mcp-server.js") },
      autoApply: () => appSettings.get().autoApply,
      features: () => appSettings.get().features,
      plugins: {
        ids: () => pluginsOn(folder.path),
        context: async (rel, section) => {
          const host = await pluginHostFor(folder.path);
          return Promise.all(
            host.contextProviders().map(async (c) => ({
              label: c.label,
              lines: await c.provide({ folder: folder.path, doc: rel, section }).catch(() => []),
            })),
          );
        },
      },
      people: async () => ({
        me: await personName(folder.path, appSettings.get().name),
        byDevice: await namesOf(folder.path),
      }),
      folderState: () =>
        [...windows.keys()].map((id) => folders.current(id)).find((f) => f?.path === folder.path) ??
        null,
      filesChanged: () => {
        for (const [id, win] of windows) {
          if (folders.current(id)?.path !== folder.path) continue;
          void folders.refresh(id).then((now) => {
            if (now) send(win, "folder:changed", now);
          });
        }
      },
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

/** The notes of a downloaded update, kept for What's new after the restart into it. */
const whatsNewFile = () => path.join(app.getPath("userData"), "whats-new.json");

/** Plain .excalidraw files per folder, scanned at most every 30 s. */
const plainScans = new Map<string, { at: number; files: Promise<string[]> }>();
function plainDrawings(root: string): Promise<string[]> {
  const kept = plainScans.get(root);
  if (kept && Date.now() - kept.at < 30_000) return kept.files;
  const files = listDocs(root, 5_000, ".excalidraw").then((r) => r.docs);
  plainScans.set(root, { at: Date.now(), files });
  return files;
}

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
  // iCloud may have offloaded the folder's files; fetch them now, not one by one as they're read.
  void fetchOffloaded(folder).catch(() => undefined);
  let target = win;
  if (folders.current(win.webContents.id)) target = createWindow();
  const outcome = await folders.open(target.webContents.id, folder);
  if (outcome.kind === "opened") {
    // 11.4: other devices hold off Clean up while this one has the folder open.
    if (device && outcome.folder.mode === "writable") {
      const at = outcome.folder.path;
      void personName(at, appSettings.get().name)
        .then((name) => noteOpened(at, device as string, new Date(), name))
        .catch(() => undefined);
    }
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
  "drawing:read": async ({ target, from }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    // Obsidian's drawings are .excalidraw.md docs, already listed. Only a plain
    // .excalidraw file needs the disk, scanned once and kept a while: a scan per
    // embed held up opening docs in a large iCloud folder.
    const found =
      findDrawing(folder.docs, target, from) ??
      findDrawing(await plainDrawings(folder.path), target, from);
    if (!found) return { kind: "failed", reason: `There's no drawing called ${target} here.` };
    const full = path.resolve(folder.path, found);
    if (!full.startsWith(path.resolve(folder.path) + path.sep))
      return { kind: "failed", reason: "That drawing is outside this folder." };
    const text = await readFile(full, "utf8").catch(() => null);
    const scene = text === null ? null : sceneOf(text, found);
    if (scene === null) return { kind: "failed", reason: `${found} has no drawing in it.` };
    return { kind: "drawing", path: found, scene, editable: folder.mode === "writable" };
  },
  "drawing:create": async ({ near, name, scene }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || folder.mode !== "writable")
      return { kind: "failed", reason: "This folder is read-only." };
    const dir = near.includes("/") ? near.slice(0, near.lastIndexOf("/") + 1) : "";
    const base =
      name
        .replace(/[\\/:*?"<>|#^[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "Drawing";
    const taken = new Set(folder.docs.map((d) => d.toLowerCase()));
    let rel = `${dir}${base}.excalidraw.md`;
    for (let n = 2; taken.has(rel.toLowerCase()); n++)
      rel = `${dir}${base} ${String(n)}.excalidraw.md`;
    const full = path.resolve(folder.path, rel);
    if (!full.startsWith(path.resolve(folder.path) + path.sep))
      return { kind: "failed", reason: "That's outside this folder." };
    try {
      await writeFile(full, withScene(emptyDrawing(), rel, scene), { flag: "wx" });
    } catch (e) {
      return { kind: "failed", reason: (e as Error).message };
    }
    const now = await folders.refresh(webContentsId);
    const win = windows.get(webContentsId);
    if (win && now) send(win, "folder:changed", now);
    return { kind: "created", path: rel };
  },
  "drawing:save": async ({ path: rel, scene }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || folder.mode !== "writable")
      return { ok: false, reason: "This folder is read-only." };
    const full = path.resolve(folder.path, rel);
    if (!full.startsWith(path.resolve(folder.path) + path.sep))
      return { ok: false, reason: "That drawing is outside this folder." };
    const text = await readFile(full, "utf8").catch(() => null);
    if (text === null) return { ok: false, reason: `${rel} is gone.` };
    await writeFileAtomic(full, withScene(text, rel, scene));
    return { ok: true, reason: null };
  },
  "base:read": async ({ target, from }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    return readEmbeddedBase(folder, target, from);
  },
  "settings:get": async (_request, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    return {
      commitAnur: folder ? await commitsAnur(folder.path) : null,
      defaultAgent: appSettings.get().defaultAgent,
      autoApply: appSettings.get().autoApply,
      name: await personName(folder?.path ?? homedir(), appSettings.get().name),
    };
  },
  "settings:set": async ({ commitAnur, defaultAgent, autoApply, name }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (name !== undefined) {
      await appSettings.set({ name: name.trim().slice(0, 80) || null });
      // Every open folder's note follows, so others see the new name on their next look.
      for (const id of windows.keys()) {
        const f = folders.current(id);
        if (f && device && f.mode === "writable")
          await noteName(f.path, device, await personName(f.path, appSettings.get().name));
      }
    }
    if (defaultAgent !== undefined) await appSettings.set({ defaultAgent });
    if (autoApply !== undefined) await appSettings.set({ autoApply });
    if (commitAnur !== undefined && folder?.mode === "writable") {
      await setCommitsAnur(folder.path, commitAnur);
    }
    return {
      commitAnur: folder ? await commitsAnur(folder.path) : null,
      defaultAgent: appSettings.get().defaultAgent,
      autoApply: appSettings.get().autoApply,
      name: await personName(folder?.path ?? homedir(), appSettings.get().name),
    };
  },
  "thread:rename": async ({ thread, path: rel, text, title }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    return { ok: t ? await t.rename(rel, text, thread, title) : false };
  },
  "thread:close": async ({ thread, path: rel, text, closed }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    return { ok: t ? await t.setClosed(rel, text, thread, closed) : false };
  },
  "thread:delete": async ({ thread }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    return t ? t.deleteThread(thread) : { kind: "refused", reason: "No folder is open." };
  },
  "storage:read": async (_, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || !device || folder.mode !== "writable")
      return { kinds: [], cleanable: { count: 0, bytes: 0 }, blockedBy: [], attachments: [] };
    const [kinds, unused, open, attachments] = await Promise.all([
      storageOf(folder.path),
      unusedSnapshots(folder.path),
      devicesStillOpen(folder.path, device),
      unusedAttachments(folder.path, folder.docs, folder.files),
    ]);
    return {
      kinds,
      cleanable: { count: unused.length, bytes: unused.reduce((n, s) => n + s.bytes, 0) },
      blockedBy: open.map((d) => ({ openedAt: d.openedAt || null })),
      attachments,
    };
  },
  "storage:clean": async (_, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || !device || folder.mode !== "writable")
      return { kind: "refused", reason: "Needs a folder Anur can write to." };
    if ((await devicesStillOpen(folder.path, device)).length > 0)
      return {
        kind: "refused",
        reason:
          "Another device has this folder open, or didn't quit cleanly. Quit Anur there first.",
      };
    const store = new SnapshotStore(path.join(folder.path, ".anur"), device);
    const found = await unusedSnapshots(folder.path);
    const removed = await removeSnapshots(
      folder.path,
      found.map((f) => f.hash),
      (h) => store.delete(h as never, "cleanup"),
    );
    return { kind: "ok", removed };
  },
  "attachment:trash": async ({ path: rel }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || folder.mode !== "writable" || !folder.files.includes(rel)) return { ok: false };
    const unused = await unusedAttachments(folder.path, folder.docs, folder.files);
    if (!unused.some((f) => f.path === rel)) return { ok: false };
    await shell.trashItem(path.join(folder.path, rel));
    return { ok: true };
  },
  "plugins:list": (_, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const on = folder ? pluginsOn(folder.path) : [];
    return {
      folder: folder?.path ?? null,
      plugins: FIRST_PARTY.map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        what: p.manifest.what,
        on: on.includes(p.manifest.id),
      })),
    };
  },
  "system:sections": async (_, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const on = folder ? pluginsOn(folder.path) : [];
    if (!folder || !on.includes("engineering")) return { kind: "off" };
    try {
      const key = on.join(",");
      const cached = systemReads.get(folder.path);
      let updating = false;
      let read: FolderRead;
      if (cached?.plugins !== key) {
        const fresh = indexProcess.sections(folder.path, on);
        systemReads.set(folder.path, { plugins: key, read: fresh });
        const where = folder.path;
        fresh.then(
          (r) => {
            saveRead(where, key, r);
          },
          // A failed read is read again next time, not kept.
          () => systemReads.delete(where),
        );
        // On launch, the last saved read draws at once; the fresh one follows.
        const saved = loadRead(folder.path, key);
        if (saved) {
          updating = true;
          read = saved;
          void fresh.then(
            () => {
              systemNotify(where);
            },
            () => undefined,
          );
        } else read = await fresh;
      } else read = await cached.read;
      const sections = read.sources.flatMap((s) => s.sections);
      const edgeState = reviewState(readReview(folder.path));
      return {
        kind: "ok",
        folder: folder.path,
        updating,
        sections,
        edges: read.edges.map((e) => ({
          ...e,
          state: edgeState.hiddenEdges.has(e.id)
            ? ("hidden" as const)
            : edgeState.confirmedEdges.has(e.id)
              ? ("confirmed" as const)
              : ("shown" as const),
        })),
        misses: read.misses,
        repos: (() => {
          const out = excludedRepos(folder.path);
          const copyOf = new Map(findRepos(folder.path).copies.map((c) => [c.dir, c.of]));
          return findRepoDirs(folder.path).map((dir) => ({
            dir,
            included: !out.has(dir),
            copyOf: copyOf.get(dir) ?? null,
          }));
        })(),
        review: systemReview.view(folder.path, sections, (prompt) => {
          const t = threadsFor(folder);
          return t ? t.askOnce(prompt) : null;
        }),
      };
    } catch (e) {
      return { kind: "failed", reason: e instanceof Error ? e.message : String(e) };
    }
  },
  "system:repo": ({ repo, include }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || !pluginsOn(folder.path).includes("engineering")) return { ok: false };
    appendReview(folder.path, [
      { kind: include ? "repo-included" : "repo-excluded", repo, at: new Date().toISOString() },
    ]);
    systemChanged(folder.path);
    return { ok: true };
  },
  "system:edge": ({ edge, action }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || !pluginsOn(folder.path).includes("engineering")) return { ok: false };
    const kind =
      action === "hide" ? "edge-hidden" : action === "show" ? "edge-shown" : "edge-confirmed";
    appendReview(folder.path, [{ kind, edge, at: new Date().toISOString() }]);
    systemChanged(folder.path);
    return { ok: true };
  },
  "system:propose": (_, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { ok: false };
    systemReview.retry(folder.path);
    return { ok: true };
  },
  "system:decide": (d, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || !pluginsOn(folder.path).includes("engineering")) return { ok: false };
    systemReview.decide(folder.path, d);
    return { ok: true };
  },
  "system:reviewed": ({ parts }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || !pluginsOn(folder.path).includes("engineering")) return { ok: false };
    systemReview.reviewed(folder.path, parts);
    return { ok: true };
  },
  "plugins:set": async ({ id, on }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder)
      return {
        kind: "refused",
        reason: "Open a folder first: plugins are switched on per folder.",
      };
    if (!pluginById(id)) return { kind: "refused", reason: `Anur has no plugin "${id}".` };
    const now = pluginsOn(folder.path).filter((x) => x !== id);
    if (on) now.push(id);
    await appSettings.set({ plugins: { ...appSettings.get().plugins, [folder.path]: now } });
    try {
      await syncPlugins(folder.path);
    } catch (e) {
      return { kind: "refused", reason: e instanceof Error ? e.message : String(e) };
    }
    return { kind: "ok" };
  },
  "orphans:list": async ({ path: rel, text }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const v = folder ? versionsFor(folder) : null;
    const t = folder ? threadsFor(folder) : null;
    if (!folder || !v || !t || !folder.docs.includes(rel)) return { orphans: [] };
    const at = await v.locate(rel, text);
    if (!at) return { orphans: [] };
    const [gone, threads] = await Promise.all([v.orphansOf(rel), t.sectionsOfThreads(rel, text)]);
    const live = at.tree.sections.map((s) => ({ path: s.path, text: subtreeText(text, s) }));
    const orphans = gone
      .map((o) => {
        const on = threads.filter((x) => x.section === o.id);
        const i = on.length > 0 || o.history ? suggestMatch(o, live) : null;
        return {
          id: o.id,
          path: o.path,
          threads: on.map((x) => ({ id: x.thread, title: x.title })),
          history: o.history,
          suggestion: i === null ? null : { index: i, path: at.tree.sections[i]?.path ?? [] },
        };
      })
      // Only what something is behind: a gone heading with no threads or history is no loss.
      .filter((o) => o.threads.length > 0 || o.history)
      .sort((a, b) => b.threads.length - a.threads.length);
    return { orphans };
  },
  "orphans:reattach": async ({ path: rel, text, orphan, section }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const v = folder ? versionsFor(folder) : null;
    if (!folder || !v || !folder.docs.includes(rel))
      return { kind: "refused", reason: "This folder is read-only." };
    const at = await v.locate(rel, text);
    const node = at?.tree.sections[section.index];
    const onto = at?.ids[section.index];
    if (!at || !node || !onto || node.path.join("\u0000") !== section.path.join("\u0000"))
      return { kind: "refused", reason: "That section has moved; pick it again." };
    try {
      await v.reattach(rel, orphan as never, onto);
    } catch (e) {
      return { kind: "refused", reason: e instanceof Error ? e.message : String(e) };
    }
    return { kind: "ok" };
  },
  "orphans:delete": async ({ path: rel, text, orphan }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const v = folder ? versionsFor(folder) : null;
    const t = folder ? threadsFor(folder) : null;
    if (!folder || !v || !t || !folder.docs.includes(rel)) return { ok: false };
    if (!(await v.orphansOf(rel)).some((o) => o.id === orphan)) return { ok: false };
    await t.forgetSection(rel, text, orphan as never);
    await v.forget(rel, orphan as never);
    return { ok: true };
  },
  "thread:undo-created": async ({ thread, id }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!t) return { kind: "refused", reason: "No folder is open." };
    const r = await t.undoCreated(thread, id);
    if (r.kind === "undone")
      await folders.refresh(webContentsId).then((now) => {
        const win = windows.get(webContentsId);
        if (win && now) send(win, "folder:changed", now);
      });
    return r;
  },
  "thread:use-all": async ({ thread, open }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!t) return { used: 0, kept: [] };
    return t.useAll(thread, open);
  },
  "thread:undo-all": async ({ thread, id, open }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!folder || !t) return { kind: "refused", reason: "No folder is open." };
    const r = await t.undoAll(thread, id, open);
    if (r.kind === "refused") return r;
    // The open doc is written by its page, so ⌘Z covers the Undo too.
    if (r.page) {
      const w = windows.get(webContentsId);
      if (w) send(w, "doc:replace", r.page);
    }
    return { kind: "undone", left: r.left };
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
  "file:incoming": async ({ into, uriList, text, obsidianFiles }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { kind: "failed", reason: "No folder is open." };
    if (folder.mode !== "writable") return { kind: "failed", reason: "This folder is read-only." };
    if (into !== "" && !folder.folders.includes(into))
      return { kind: "failed", reason: `There's no folder ${into}.` };
    const found = await resolveIncoming(
      { uriList, text, obsidianFiles },
      await obsidianVaults(app.getPath("appData")),
    );
    if (found.paths.length) {
      const copied = await copyInto(folder, found.paths, into);
      if (copied.kind === "failed") return copied;
      const now = await folders.refresh(webContentsId);
      return now ? { ...copied, folder: now } : { kind: "failed", reason: "The folder closed." };
    }
    if (found.reason) return { kind: "failed", reason: found.reason };
    if (!found.text) return { kind: "failed", reason: "There was nothing Anur could use in that." };
    const file = await docFromText(path.join(folder.path, into), found.text);
    const now = await folders.refresh(webContentsId);
    return now
      ? { kind: "made", path: into ? `${into}/${file}` : file, folder: now }
      : { kind: "failed", reason: "The folder closed." };
  },
  "edit:paste": (_req, { webContentsId }) => {
    const win = windows.get(webContentsId);
    win?.webContents.paste();
    return { ok: !!win };
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
  "map:ink": async ({ path: doc, text }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const ids = folder ? versionsFor(folder) : null;
    if (!folder || !ids || !device || !folder.docs.includes(doc)) return { strokes: [] };
    const at = await ids.locate(doc, text);
    if (!at) return { strokes: [] };
    return { strokes: await new MapInk(folder.path, device).read(at.doc) };
  },
  "map:ink-change": async ({ path: doc, text, add, erase }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const ids = folder ? versionsFor(folder) : null;
    if (!folder || folder.mode !== "writable" || !ids || !device || !folder.docs.includes(doc))
      return { ok: false };
    const at = await ids.locate(doc, text);
    if (!at) return { ok: false };
    await new MapInk(folder.path, device).change(at.doc, add, erase);
    return { ok: true };
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
        // No folder open: an empty folder of Anur's own. Home would have the
        // agent look around it, and macOS ask about Downloads and Documents.
        cwd: folders.current(webContentsId)?.path ?? probeFolder(),
      });
    }
    return { options: choices.get(agent) };
  },
  "thread:start": async (
    { path: doc, text, section, message, agent, options, purpose, branch, files },
    { webContentsId },
  ) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!folder || !t || !folder.docs.includes(doc))
      return { kind: "refused", reason: "Threads need a doc in a folder Anur can write to." };
    return t.start(doc, text, section, message, agent, options, purpose, branch, files ?? []);
  },
  "thread:send": async ({ thread, path: doc, text, message, files }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!folder || !t || !folder.docs.includes(doc))
      return { kind: "refused", reason: "Threads need a doc in a folder Anur can write to." };
    if (files?.length) await t.attach(doc, text, thread, files);
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
  "history:list": async ({ path: rel, text, section }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const v = folder ? versionsFor(folder) : null;
    if (!folder || !v) return { versions: [], commits: [] };
    const [versions, commits] = await Promise.all([
      v.list(rel, text, section.path),
      sectionCommits(folder.path, rel, section.path),
    ]);
    return { versions, commits };
  },
  "history:restored": async ({ path: rel, text, section, from }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (folder) await versionsFor(folder)?.restored(rel, text, section, from);
    return {};
  },
  "finding:decide": async ({ thread, id, status, claim, add }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!t) return { kind: "refused", reason: "No folder is open." };
    if (add) return t.decideFinding(thread, { add });
    if (!id || !status) return { kind: "refused", reason: "Say which finding, and keep or drop." };
    return t.decideFinding(thread, { id, status, claim: claim ?? null });
  },
  "findings:list": async ({ path: rel, text, section }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!t) return { findings: [] };
    const list = await t.listFindings(rel, text, section.index, section.path);
    return {
      findings: list.map((f) => ({
        id: f.id,
        thread: f.thread,
        claim: f.claim,
        source: f.source,
        section: f.section,
        by: f.by,
        quote: f.quote,
        // Names show only on someone else's decisions.
        who: f.mine ? null : f.who,
        instead: f.instead,
        until: f.until,
        at: f.at,
      })),
    };
  },
  "links:of": async ({ path: rel, text, section }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    if (!t) return { out: [], into: [] };
    const { out, into } = await t.linksAround(rel, text, section.path);
    const seen = new Set<string>();
    return {
      out: out
        .filter((l) => l.doc !== rel)
        .filter((l) => {
          const key = `${l.doc ?? l.written}#${l.heading ?? ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((l) => ({ doc: l.doc, heading: l.heading, written: l.written })),
      into: into.map((l) => ({ doc: l.from.doc, path: l.from.path })),
    };
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
        local: c.local,
      })),
    };
  },
  "inputs:add": async ({ path: rel, text, section, thread, files, links }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder?.mode === "writable" ? threadsFor(folder) : null;
    if (!t) return { error: "Inputs need a folder Anur can write to." };
    const r = await t.addInputs(rel, text, section.index, section.path, thread, files, links);
    const win = windows.get(webContentsId);
    // An attachment copied into the folder shows in the files panel.
    if ("added" in r && files.length && win) {
      const now = await folders.refresh(webContentsId);
      if (now) send(win, "folder:changed", now);
    }
    return r;
  },
  "inputs:pick-files": async (_req, { webContentsId }) => {
    const win = windows.get(webContentsId);
    if (!win) return { files: [] };
    const picked = await dialog.showOpenDialog(win, {
      title: "Attach files or folders",
      buttonLabel: "Attach",
      // Files and folders both, as in Claude: a folder goes as a whole.
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    return { files: picked.canceled ? [] : picked.filePaths };
  },
  "inputs:remove": async ({ path: rel, text, thread, input }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    const t = folder ? threadsFor(folder) : null;
    return { ok: t ? await t.removeInput(rel, text, thread, input) : false };
  },
  "agent:sessions": async () => ({
    live: hub.liveSessions(),
    limit: appSettings.get().sessionLimit,
    memoryMb: hub.liveSessions() > 0 ? await agentMemoryMb(hub.hostPid()) : null,
  }),
  "agent:set-session-limit": async ({ limit }) => {
    await appSettings.set({ sessionLimit: limit });
    hub.setLimit(limit);
    return {
      live: hub.liveSessions(),
      limit,
      memoryMb: hub.liveSessions() > 0 ? await agentMemoryMb(hub.hostPid()) : null,
    };
  },
  "features:get": () => appSettings.get().features,
  "features:set": async ({ id, on }) => {
    const features = { ...appSettings.get().features, [id]: on };
    await appSettings.set({ features });
    for (const win of windows.values()) send(win, "features:changed", features);
    return features;
  },
  "update:status": () => ({
    state: updateState(),
    version: app.getVersion(),
    auto: appSettings.get().autoUpdate,
  }),
  "update:check": () => {
    checkNow();
    return { ok: updateState().kind !== "off" };
  },
  "update:download": () => {
    download();
    return { ok: updateState().kind === "downloading" };
  },
  "update:set-auto": async ({ auto }) => {
    await appSettings.set({ autoUpdate: auto });
    setAuto(auto);
    return { auto };
  },
  "app:whats-new": async ({ seen }) => {
    const file = whatsNewFile();
    const saved = await readFile(file, "utf8")
      .then((t) => JSON.parse(t) as { version?: string; notes?: string[] })
      .catch(() => null);
    // Only on the version it was saved for: an update that didn't install shows nothing.
    if (!saved?.version || saved.version !== app.getVersion() || !saved.notes?.length) return null;
    if (seen) await rm(file, { force: true });
    return { version: saved.version, notes: saved.notes };
  },
  "update:restart": () => {
    restartToUpdate();
    return { ok: updateState().kind === "ready" };
  },
  "tour:status": async () => {
    // Checks don't see it unless they ask, so other checks' screenshots stay clean.
    if (isCheck && !process.env.ANUR_CHECK_TOUR) return { show: false };
    const seen = await readFile(path.join(app.getPath("userData"), "tour.json"), "utf8").then(
      () => true,
      () => false,
    );
    return { show: !seen };
  },
  "tour:done": async () => {
    await writeFile(
      path.join(app.getPath("userData"), "tour.json"),
      JSON.stringify({ seen: true }),
    );
    return { ok: true };
  },
  "opener:status": async () => {
    const current = await markdownOpener();
    return {
      // Only the installed app can be the opener; a dev build would hand .md files to Electron.
      can: process.platform === "darwin" && (app.isPackaged || !!process.env.ANUR_CHECK_OPENER),
      isAnur: current?.id === (isRelease ? BUNDLE_ID : DEV_BUNDLE_ID),
      current: current?.name ?? null,
      dismissed: await openerOffer().dismissed(),
    };
  },
  "opener:act": async ({ action }) => {
    if (action === "dismiss") {
      await openerOffer().dismiss();
      return { ok: true };
    }
    if (!app.isPackaged) return { ok: false };
    return { ok: await makeMarkdownOpener(isRelease ? BUNDLE_ID : DEV_BUNDLE_ID) };
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
  "system:repoDirs": (_, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || !pluginsOn(folder.path).includes("engineering")) return { repos: [] };
    // Code repos only: a notes or docs repo stays in the tree with the other folders.
    const copyOf = new Map(findRepos(folder.path).copies.map((c) => [c.dir, c.of]));
    return {
      repos: includedRepoDirs(folder.path)
        .filter((d) => d !== "." && looksLikeCode(path.join(folder.path, d)))
        .map((dir) => ({ dir, copyOf: copyOf.get(dir) ?? null })),
    };
  },
  "anur:publicRepo": async (_, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder || folder.mode !== "writable") return { folder: null, repo: null };
    return { folder: folder.path, repo: await publicRepoFor(folder.path) };
  },
  "engineering:offer": (_, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { folder: null, repos: 0, on: false };
    return {
      folder: folder.path,
      repos: codeRepos(folder.path),
      on: pluginsOn(folder.path).includes("engineering"),
    };
  },
  "tasks:list": (_, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    if (!folder) return { reports: [] };
    reportWatch.ensure(folder.path);
    return { reports: listReports(folder.path) };
  },
  "tasks:get": ({ id }, { webContentsId }) => {
    const folder = folders.current(webContentsId);
    return { report: folder ? readReport(folder.path, id) : null };
  },
  "taskHooks:status": async () =>
    taskHooks ? taskHooks.status() : { claude: false, added: false, current: false },
  "taskHooks:act": async ({ action }) => {
    if (!taskHooks) return { kind: "failed", reason: "Anur is still starting." };
    try {
      if (action === "add") await taskHooks.add();
      else await taskHooks.remove();
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
    // A click on a window that isn't in front also does what it lands on,
    // so clicking a row in another Anur window then ⌘V pastes there.
    acceptFirstMouse: true,
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
  // A two-finger swipe goes back and forward, as in Chrome (when the Mac's trackpad allows it).
  win.on("swipe", (_e, direction) => {
    if (direction === "right") send(win, "app:command", { command: "back" });
    else if (direction === "left") send(win, "app:command", { command: "forward" });
  });
  win.on("closed", () => {
    const folder = folders.current(id);
    const shown = shownDoc.get(id);
    if (folder && shown) void versionsFor(folder)?.endSession(shown);
    shownDoc.delete(id);
    windows.delete(id);
    docWatcher.stop(id);
    folderWatch.stop(id);
    senders.remove(id);
    if (folder && device && folder.mode === "writable")
      quitNotes.add(noteQuit(folder.path, device).catch(() => undefined));
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

/** Once the window's page is up and listening; a new window gets a moment to mount. */
const whenLoaded = (win: BrowserWindow) =>
  win.webContents.isLoading()
    ? new Promise<void>((resolve) => {
        win.webContents.once("did-finish-load", () => {
          setTimeout(resolve, 400);
        });
      })
    : Promise.resolve();

/** A Markdown file opened from Finder: open the folder it belongs to, then the doc. */
async function openMarkdownFile(chosen: string) {
  const file = await realpath(chosen).catch(() => chosen);
  const open = [...windows.keys()].flatMap((id) => folders.current(id)?.path ?? []);
  const recent = await readRecent(app.getPath("userData")).catch(() => []);
  const folder = await folderFor(file, open, recent, homedir());
  const id = folders.windowFor(folder);
  let target = id === null ? undefined : windows.get(id);
  if (!target) {
    const win = focusedOrNew();
    await whenLoaded(win);
    const outcome = await openFolderIn(win, folder);
    const at =
      outcome.kind === "opened"
        ? folders.windowFor(outcome.folder.path)
        : outcome.kind === "elsewhere"
          ? outcome.windowId
          : null;
    target = at === null ? undefined : windows.get(at);
  }
  const root = target ? folders.current(target.webContents.id)?.path : undefined;
  if (!target || !root) return;
  await whenLoaded(target);
  if (target.isMinimized()) target.restore();
  target.focus();
  const rel = path.relative(root, file).split(path.sep).join("/");
  send(target, "app:open-doc", { path: rel, section: null });
}

/** Files macOS asked Anur to open before it was ready, as when a double-click launched it. */
const filesToOpen: string[] = [];
let readyForFiles = false;
app.on("open-file", (event, file) => {
  event.preventDefault();
  if (readyForFiles) void openMarkdownFile(file);
  else filesToOpen.push(file);
});

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
        // ANUR_SCREENSHOT_PASTE pastes where the page's focus is, as Edit → Paste does.
        if (process.env.ANUR_SCREENSHOT_PASTE) {
          win.webContents.paste();
          await new Promise((r) => setTimeout(r, 1200));
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
  hub.setLimit(appSettings.get().sessionLimit);
  device = await loadDeviceId(app.getPath("userData")).catch((e: unknown) => {
    console.error("Anur couldn't read this install's device ID:", e);
    return null;
  });
  recovery = new RecoveryStore(app.getPath("userData"));
  folders = new FolderService(
    app.getPath("userData"),
    isCheck ? (process.env.ANUR_CHECK_HOME ?? undefined) : undefined,
    // Anur and Anur Dev share locks, so they never both write one folder.
    isCheck ? app.getPath("userData") : sharedProfile,
  );
  // No page in Anur needs the camera, microphone, location or notifications.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  registerIpc();
  void startClaudeSkill();
  if (isRelease) await offerMoveToApplications();
  if (isRelease)
    startUpdates(
      appSettings.get().autoUpdate,
      (state) => {
        for (const win of windows.values()) send(win, "app:update-state", state);
      },
      (version, notes) => {
        void writeFile(whatsNewFile(), JSON.stringify({ version, notes })).catch(() => undefined);
      },
    );
  else if (isCheck && process.env.ANUR_CHECK_UPDATE)
    showForCheck(process.env.ANUR_CHECK_UPDATE, (state) => {
      for (const win of windows.values()) send(win, "app:update-state", state);
    });
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
      checkUpdates: () => {
        checkNow();
        send(focusedOrNew(), "app:command", { command: "updates" });
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

  // Reopen a folder: ANUR_OPEN_FOLDER for checks, otherwise the last one opened;
  // a file double-clicked in Finder opens its own folder instead.
  const reopen =
    process.env.ANUR_OPEN_FOLDER ??
    (isCheck || filesToOpen.length > 0
      ? undefined
      : (await readRecent(app.getPath("userData")))[0]);
  readyForFiles = true;
  for (const file of filesToOpen.splice(0)) await openMarkdownFile(file);
  // ANUR_CHECK_OPEN_FILE stands in for a double-click in Finder.
  if (process.env.ANUR_CHECK_OPEN_FILE) void openMarkdownFile(process.env.ANUR_CHECK_OPEN_FILE);
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
    indexProcess.stop();
    reportWatch.stop();
    anurSocket.close();
    await Promise.all([...threads.values()].map((t) => t.close()));
    // Windows close before will-quit: their notes are written by now or soon (11.4).
    await Promise.all(quitNotes);
    await Promise.all(
      [...windows.keys()].map(async (id) => {
        const f = folders.current(id);
        if (f && device && f.mode === "writable")
          await noteQuit(f.path, device).catch(() => undefined);
      }),
    );
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
/** Each closed window's "quit cleanly" note, awaited before the app exits (11.4). */
const quitNotes = new Set<Promise<void>>();

// A window with unsaved typing holds its close until the save lands
// (the page's beforeunload), then closes itself; a quit carries on after it.
let quitting = false;
app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || quitting) app.quit();
});
