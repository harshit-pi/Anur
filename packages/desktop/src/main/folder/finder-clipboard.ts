import { fileURLToPath } from "node:url";

/**
 * Files on the clipboard as Finder puts them there, and back: a property
 * list of paths, so ⌘C in Anur pastes in Finder and the other way round.
 */
export const FILES_TYPE = 'electron application/osclipboard;format="NSFilenamesPboardType"';

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The paths in Finder's property list, or in a list of file URLs when that's all there is. */
export function readFilePaths(plist: string, uriList: string): string[] {
  const listed = [...plist.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => unescape(m[1] ?? ""));
  if (listed.length > 0) return listed.filter((p) => p.startsWith("/"));
  return uriList.split(/\r?\n/).flatMap((line) => {
    const url = line.trim();
    if (!url.startsWith("file://")) return [];
    try {
      return [fileURLToPath(url)];
    } catch {
      return [];
    }
  });
}

export function filePathsPlist(paths: readonly string[]): string {
  const items = paths.map((p) => `<string>${escape(p)}</string>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><array>${items}</array></plist>\n`;
}
