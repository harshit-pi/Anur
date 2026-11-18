import electronUpdater from "electron-updater";

/**
 * Updates for the released app: the feed is checked on launch and every few
 * hours, an update downloads quietly, and the page offers a restart once it's
 * ready. An update not restarted for installs when Anur quits. Anur Dev never
 * updates itself.
 */
export const FEED_URL = "https://do7t8q39ulre5.cloudfront.net/";
const EVERY_MS = 4 * 60 * 60 * 1000;

const { autoUpdater } = electronUpdater;
let ready: string | null = null;

export function startUpdates(onReady: (version: string) => void) {
  autoUpdater.setFeedURL({ provider: "generic", url: FEED_URL });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", (info) => {
    ready = info.version;
    onReady(info.version);
  });
  // Offline or a feed that's down: try again at the next check, quietly.
  autoUpdater.on("error", () => undefined);
  const check = () => {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  };
  check();
  setInterval(check, EVERY_MS);
}

/** The version downloaded and waiting for a restart, if any. */
export const updateReady = () => ready;

export function restartToUpdate() {
  if (ready) autoUpdater.quitAndInstall();
}
