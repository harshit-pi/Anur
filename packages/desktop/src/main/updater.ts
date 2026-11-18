import electronUpdater from "electron-updater";
import type { UpdateState } from "../shared/ipc-contract.ts";

/**
 * Updates for the released app. The feed is checked on launch and every few
 * hours. With automatic installs on (the default), a new version downloads
 * quietly, a card offers Restart, and it installs on quit; off, Anur only
 * says one is available and downloads when asked. Anur never restarts by
 * itself. Anur Dev never updates.
 */
export const FEED_URL = "https://do7t8q39ulre5.cloudfront.net/";
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

export function startUpdates(auto: boolean, onState: (s: UpdateState) => void) {
  tell = onState;
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
        ? { kind: "downloading", version: info.version, percent: 0 }
        : { kind: "available", version: info.version },
    );
  });
  autoUpdater.on("download-progress", (p) => {
    if (state.kind === "downloading") set({ ...state, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    set({ kind: "ready", version: info.version });
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
