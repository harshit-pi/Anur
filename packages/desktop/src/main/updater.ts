import electronUpdater from "electron-updater";
import type { UpdateState } from "../shared/ipc-contract.ts";
import { notesFrom } from "../shared/release-notes.ts";

/**
 * Updates for the released app. The feed is checked on launch and every few
 * hours. With automatic installs on (the default), a new version downloads
 * quietly, a card offers Restart, and it installs on quit; off, Anur only
 * says one is available and downloads when asked. With automatic installs
 * on, it also restarts into a ready update when nobody could notice
 * (quiet-restart.ts). Anur Dev never updates.
 */
export const FEED_URL = "https://spaces.hianur.com/";
const EVERY_MS = 4 * 60 * 60 * 1000;

const { autoUpdater } = electronUpdater;
let state: UpdateState = { kind: "off" };
let tell: (s: UpdateState) => void = () => undefined;

const set = (next: UpdateState) => {
  state = next;
  tell(next);
};

/** What went wrong, in words: no connection, or the server. */
export function reasonOf(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return /ENOTFOUND|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK/i.test(
    text,
  )
    ? "no connection"
    : "the update server didn't answer";
}

let onDownloaded: (version: string, notes: string[]) => void = () => undefined;

export function startUpdates(
  auto: boolean,
  onState: (s: UpdateState) => void,
  downloaded: (version: string, notes: string[]) => void = () => undefined,
) {
  tell = onState;
  onDownloaded = downloaded;
  autoUpdater.setFeedURL({ provider: "generic", url: FEED_URL });
  setAuto(auto);
  state = { kind: "idle", checkedAt: null };
  autoUpdater.on("checking-for-update", () => {
    if (state.kind !== "downloading" && state.kind !== "ready") set({ kind: "checking" });
  });
  autoUpdater.on("update-not-available", () => {
    set({ kind: "idle", checkedAt: new Date().toISOString() });
  });
  autoUpdater.on("update-available", (info) => {
    if (state.kind === "ready") return;
    set(
      autoUpdater.autoDownload
        ? {
            kind: "downloading",
            version: info.version,
            percent: 0,
            notes: notesFrom(info.releaseNotes),
          }
        : { kind: "available", version: info.version, notes: notesFrom(info.releaseNotes) },
    );
  });
  autoUpdater.on("download-progress", (p) => {
    if (state.kind === "downloading") set({ ...state, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    const notes = notesFrom(info.releaseNotes);
    set({ kind: "ready", version: info.version, notes });
    // Shown once, after the restart into this version.
    onDownloaded(info.version, notes);
  });
  autoUpdater.on("error", (e) => {
    // A failed background check stays quiet once a version is waiting.
    if (state.kind !== "ready") set({ kind: "error", reason: reasonOf(e) });
  });
  checkNow();
  setInterval(checkNow, EVERY_MS);
}

export function checkNow() {
  if (state.kind === "off" || state.kind === "ready" || state.kind === "downloading") return;
  void autoUpdater.checkForUpdates().catch(() => undefined);
}

/** Download the version found, when automatic installs are off. */
export function download() {
  if (state.kind !== "available") return;
  set({ kind: "downloading", version: state.version, percent: 0 });
  void autoUpdater.downloadUpdate().catch(() => undefined);
}

export function setAuto(auto: boolean) {
  autoUpdater.autoDownload = auto;
  autoUpdater.autoInstallOnAppQuit = auto;
  if (auto && state.kind === "available") download();
}

export const updateState = () => state;

export function restartToUpdate() {
  if (state.kind === "ready") autoUpdater.quitAndInstall();
}

/** For checks: ANUR_CHECK_UPDATE shows a state ("available", "downloading" or "ready") as if found. */
export function showForCheck(kind: string, onState: (s: UpdateState) => void) {
  tell = onState;
  const version = "9.9.9";
  const notes = [
    "Excalidraw drawings show on the page and open full size to edit.",
    "Mermaid diagrams draw on the page.",
    "Search finds docs by any words, in any order.",
    "The map can open as a drawing, look hand-drawn, and take pen notes.",
    "⌘[ and ⌘] go back and forward.",
  ];
  if (kind === "available") set({ kind: "available", version, notes });
  else if (kind === "downloading") set({ kind: "downloading", version, percent: 42 });
  else if (kind === "ready") set({ kind: "ready", version, notes });
}
