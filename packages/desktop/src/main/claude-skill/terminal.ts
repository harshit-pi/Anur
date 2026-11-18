import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ToolAnswer } from "../threads/anur-socket.ts";

/**
 * The tools an agent in the person's own terminal reaches through the
 * `/anur` skill (6.4 to 6.9). There is no thread: each call works on the
 * folder open in Anur's front window, reading docs as they are on disk.
 */

export type TerminalDeps = {
  /** The folder open in the front window, and that window's id; null when none. */
  front: () => { folder: string; docs: string[]; webContentsId: number } | null;
  outline: (folder: string, rel: string, text: string) => Promise<string | null>;
  bundle: (folder: string, rel: string, text: string, section: string) => Promise<string | null>;
  threads: (folder: string, rel: string, text: string) => Promise<string | null>;
  /** A section's links in and out (8.4); the title's when no section is named. */
  links: (folder: string, rel: string, text: string, section: string | null) => Promise<ToolAnswer>;
  propose: (
    folder: string,
    rel: string,
    text: string,
    section: string,
    body: string,
    summary: string | null,
  ) => Promise<string | null>;
  /** Make a doc with this text in the front window's folder; its path, or why not. */
  create: (
    webContentsId: number,
    name: string,
    markdown: string,
  ) => Promise<{ path: string } | { error: string }>;
  keepChat: (
    folder: string,
    rel: string,
    text: string,
    chat: {
      summary: string;
      transcript: string | null;
      inputs: {
        source: "file" | "fetch" | "command" | "mcp";
        label: string;
        ref: string;
        content: string | null;
      }[];
    },
  ) => Promise<string | null>;
  /** Show a doc in the front window, at a section if given. */
  open: (webContentsId: number, rel: string, section: string | null) => void;
};

/** A doc named by path in the folder, full path, or name. */
function resolveDoc(folder: string, docs: string[], given: string): string | null {
  const g = given.trim();
  const rel = path.isAbsolute(g) ? path.relative(folder, g) : g.replace(/^\.?\//, "");
  const norm = rel.split(path.sep).join("/");
  const withMd = /\.md$/i.test(norm) ? norm : `${norm}.md`;
  const lower = withMd.toLowerCase();
  return (
    docs.find((d) => d.toLowerCase() === lower) ??
    docs.find((d) => d.toLowerCase().endsWith(`/${lower}`)) ??
    null
  );
}

/** The newest Claude Code transcript for a terminal's folder, as Claude Code files them. */
async function latestTranscript(cwd: string): Promise<string | null> {
  const dir = path.join(os.homedir(), ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl"));
  } catch {
    return null;
  }
  let best: { file: string; at: number } | null = null;
  for (const n of names) {
    const s = await stat(path.join(dir, n)).catch(() => null);
    if (s && (!best || s.mtimeMs > best.at)) best = { file: path.join(dir, n), at: s.mtimeMs };
  }
  return best ? readFile(best.file, "utf8").catch(() => null) : null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function terminalHandler(d: TerminalDeps) {
  return async (tool: string, raw: unknown): Promise<ToolAnswer> => {
    const args = (raw ?? {}) as Record<string, unknown>;
    const front = d.front();
    if (!front)
      return { error: "Anur has no folder open. Ask the person to open one, then try again." };
    const { folder, docs, webContentsId } = front;

    if (tool === "anur_create_doc") {
      const name = str(args.name);
      const markdown = typeof args.markdown === "string" ? args.markdown : null;
      if (!name || markdown === null) return { error: "Give the doc a name and its Markdown." };
      const made = await d.create(
        webContentsId,
        /\.md$/i.test(name) ? name : `${name}.md`,
        markdown,
      );
      if ("error" in made) return made;
      const summary = str(args.summary);
      if (summary) {
        const cwd = str(args._cwd);
        const inputs = Array.isArray(args.inputs) ? (args.inputs as Record<string, unknown>[]) : [];
        const kept = await Promise.all(
          inputs.flatMap((i) => {
            const ref = str(i.ref);
            if (!ref) return [];
            const kind = i.kind;
            return [
              (async () => {
                if (kind === "file") {
                  // Agents sometimes add a note after the path: "notes.txt — what it says".
                  const bare = ref.split(/\s+[—–-]\s+/)[0]?.replace(/^`|`$/g, "") ?? ref;
                  const full = path.isAbsolute(bare) ? bare : path.join(cwd ?? folder, bare);
                  const content = await readFile(full, "utf8").catch(() => null);
                  // Named as the chat would: relative to where it ran, else by its name.
                  const near = cwd ? path.relative(cwd, full) : null;
                  const label = near && !near.startsWith("..") ? near : path.basename(full);
                  return { source: "file" as const, label, ref: full, content };
                }
                if (kind === "url")
                  return { source: "fetch" as const, label: ref, ref, content: null };
                if (kind === "command")
                  return { source: "command" as const, label: `$ ${ref}`, ref, content: null };
                return { source: "mcp" as const, label: ref, ref, content: null };
              })(),
            ];
          }),
        );
        await d.keepChat(folder, made.path, markdown, {
          summary,
          transcript: cwd ? await latestTranscript(cwd) : null,
          inputs: kept,
        });
      }
      d.open(webContentsId, made.path, null);
      return {
        text: `Made ${made.path} in Anur's open folder, and opened it.${summary ? " This chat is kept on its title." : ""}`,
      };
    }

    const given = str(args.doc);
    if (!given) return { error: "Say which doc." };
    const rel = resolveDoc(folder, docs, given);
    if (!rel) return { error: `There's no ${given} in the folder open in Anur (${folder}).` };
    const text = await readFile(path.join(folder, rel), "utf8").catch(() => null);
    if (text === null) return { error: `${rel} couldn't be read.` };
    const section = str(args.section);

    if (tool === "anur_outline") {
      const out = await d.outline(folder, rel, text);
      return out ? { text: out } : { error: `${rel} couldn't be read as sections.` };
    }
    if (tool === "anur_list_threads") {
      const out = await d.threads(folder, rel, text);
      return out ? { text: out } : { error: `${rel} couldn't be read as sections.` };
    }
    if (tool === "anur_links") return d.links(folder, rel, text, section);
    if (tool === "anur_section_bundle") {
      if (!section) return { error: "Say which section." };
      const out = await d.bundle(folder, rel, text, section);
      return out ? { text: out } : { error: `There's no section "${section}" in ${rel}.` };
    }
    if (tool === "anur_propose_preview") {
      const body = typeof args.text === "string" ? args.text : null;
      if (!section || body === null) return { error: "Say which section, and its new text." };
      const at = await d.propose(folder, rel, text, section, body, str(args.summary));
      return at
        ? {
            text: `Proposed new text for "${at}" in ${rel}. It shows in Anur as a proposed edit; the person decides.`,
          }
        : { error: `There's no section "${section}" in ${rel}.` };
    }
    if (tool === "anur_open") {
      d.open(webContentsId, rel, section);
      return { text: `Opened ${rel} in Anur${section ? `, at "${section}"` : ""}.` };
    }
    return { error: `Anur has no tool ${tool}.` };
  };
}

/** Where the terminal's socket and token go: a file only this account can read (6.4). */
export async function writeTerminalFile(
  file: string,
  socket: string,
  token: string,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(file), 0o700);
  await writeFile(file, JSON.stringify({ socket, token }), { mode: 0o600 });
  await chmod(file, 0o600);
}
