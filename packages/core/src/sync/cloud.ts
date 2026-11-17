/**
 * Cloud folders (Sync and Collaboration, "Cloud folders"). A vault may sit
 * in iCloud or Dropbox, so Anur says so when it is opened, keeps its caches
 * and lock outside it, and warns about git inside it.
 */
export type CloudProvider = "icloud" | "dropbox" | "onedrive" | "google-drive" | "cloud";

export const PROVIDER_NAME: Record<CloudProvider, string> = {
  icloud: "iCloud Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  "google-drive": "Google Drive",
  cloud: "a cloud folder",
};

/** Which sync service keeps a folder, from its real path; null for a plain local folder. */
export function cloudProviderOf(realPath: string, home: string): CloudProvider | null {
  const p = realPath.replace(/\\/g, "/");
  const h = home.replace(/\\/g, "/").replace(/\/$/, "");
  const under = (prefix: string) => p === prefix || p.startsWith(`${prefix}/`);
  if (under(`${h}/Library/Mobile Documents`)) return "icloud";
  if (under(`${h}/Dropbox`)) return "dropbox";
  const storage = `${h}/Library/CloudStorage`;
  if (under(storage)) {
    const top = p.slice(storage.length + 1).split("/")[0] ?? "";
    if (top.startsWith("Dropbox")) return "dropbox";
    if (top.startsWith("OneDrive")) return "onedrive";
    if (top.startsWith("GoogleDrive")) return "google-drive";
    if (top.startsWith("iCloud")) return "icloud";
    return "cloud";
  }
  return null;
}
