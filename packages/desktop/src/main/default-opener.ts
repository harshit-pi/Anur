import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Which app opens Markdown files when they're double-clicked in Finder, and
 * making it Anur when the person asks. Launch Services is asked through a
 * short JXA script, since Electron has no call for file types.
 */
/** The released app's bundle id, and Anur Dev's beside it. */
export const BUNDLE_ID = "ai.heyanur.anur-desktop";
export const DEV_BUNDLE_ID = "ai.heyanur.anur-desktop.dev";

/** The types a .md file can be: the one this Mac gives ".md", and Markdown's usual one. */
const TYPES = `const types = [...new Set([
  ObjC.castRefToObject($.UTTypeCreatePreferredIdentifierForTag($("public.filename-extension"), $("md"), $())).js,
  "net.daringfireball.markdown",
].filter((t) => t && !t.startsWith("dyn.")))];`;

const READ = `ObjC.import("CoreServices"); ObjC.import("AppKit");
function run() {
  ${TYPES}
  const ref = $.LSCopyDefaultRoleHandlerForContentType($(types[0]), 0xFFFFFFFF);
  const id = ref.isNil && ref.isNil() ? "" : (ObjC.castRefToObject(ref).js || "");
  const url = id ? $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(id) : $();
  const name = url.isNil() ? "" : url.lastPathComponent.js.replace(/\\.app$/, "");
  return JSON.stringify({ id, name });
}`;

const SET = `ObjC.import("CoreServices");
function run(argv) {
  ${TYPES}
  return String(types.every((t) => $.LSSetDefaultRoleHandlerForContentType($(t), 0xFFFFFFFF, $(argv[0])) === 0));
}`;

const jxa = (script: string, args: string[] = []) =>
  new Promise<string>((resolve) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", script, ...args],
      { timeout: 10_000 },
      (err, out) => {
        resolve(err ? "" : out.trim());
      },
    );
  });

/** The app that opens .md files now, by bundle id and name; null when none is set. */
export async function markdownOpener(): Promise<{ id: string; name: string } | null> {
  if (process.platform !== "darwin") return null;
  try {
    const got = JSON.parse(await jxa(READ)) as { id: string; name: string };
    return got.id ? got : null;
  } catch {
    return null;
  }
}

export async function makeMarkdownOpener(bundleId: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  return (await jxa(SET, [bundleId])) === "true";
}

/** Whether the person said Not now to the offer, kept in app support. */
export class OpenerOffer {
  private readonly file: string;
  constructor(dir: string) {
    this.file = path.join(dir, "default-opener.json");
  }
  async dismissed(): Promise<boolean> {
    try {
      return (
        (JSON.parse(await readFile(this.file, "utf8")) as { dismissed?: boolean }).dismissed ===
        true
      );
    } catch {
      return false;
    }
  }
  async dismiss(): Promise<void> {
    await writeFile(this.file, JSON.stringify({ dismissed: true }));
  }
}
