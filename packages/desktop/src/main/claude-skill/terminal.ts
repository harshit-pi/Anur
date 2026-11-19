import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DecisionScope, settleRule } from "@anur/core";
import { aboutFiles, filesFrom, type About } from "@anur/system";
import type { ToolAnswer } from "../threads/anur-socket.ts";
import type { CommittedDecisions, KeptEntry } from "../committed-decisions.ts";

/**
 * The tools an agent in the person's own terminal reaches through the
 * `/anur` skill (6.4 to 6.9). There is no thread: each call works on the
 * folder open in Anur's front window, reading docs as they are on disk.
 */

export type TerminalDeps = {
  /** The part or line files are about (23.1); the system's own lookup by default. */
  about?: (folder: string, files: string[]) => About | null;
  /** The folder open in the front window, and that window's id; null when none. */
  front: () => { folder: string; docs: string[]; webContentsId: number } | null;
  outline: (folder: string, rel: string, text: string) => Promise<string | null>;
  bundle: (folder: string, rel: string, text: string, section: string) => Promise<string | null>;
  threads: (folder: string, rel: string, text: string) => Promise<string | null>;
  /** A section's links in and out (8.4); the title's when no section is named. */
  links: (folder: string, rel: string, text: string, section: string | null) => Promise<ToolAnswer>;
  /** anur_search_sections: sections across the folder with every word. */
  search: (words: string) => Promise<ToolAnswer>;
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
  /** A section named by heading, as its heading path; null when there's none. */
  sectionPath: (
    folder: string,
    rel: string,
    text: string,
    section: string,
  ) => Promise<string[] | null>;
  /** Decisions and kept findings committed where the session works (23.4), from `base`. */
  committed: (base: string) => Pick<CommittedDecisions, "keep" | "keepFor" | "drop">;
  /** The person's name, as decisions show it. */
  me: () => Promise<string | null>;
  /** The session's transcript; Claude Code's own file for that folder unless given. */
  transcript?: (cwd: string) => Promise<string | null>;
};

/**
 * What the person typed in a Claude Code session, from its transcript: their
 * own messages, not tool results, command echoes or Claude Code's notes.
 */
export function personSaid(transcript: string | null): { id: string; text: string }[] {
  if (!transcript) return [];
  const out: { id: string; text: string }[] = [];
  transcript.split("\n").forEach((row, i) => {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(row) as Record<string, unknown>;
    } catch {
      return;
    }
    if (o.type !== "user" || o.isMeta === true) return;
    const m = o.message as { role?: unknown; content?: unknown } | undefined;
    if (m?.role !== "user") return;
    const texts =
      typeof m.content === "string"
        ? [m.content]
        : Array.isArray(m.content)
          ? (m.content as { type?: unknown; text?: unknown }[]).flatMap((c) =>
              c.type === "text" && typeof c.text === "string" ? [c.text] : [],
            )
          : [];
    for (const t of texts)
      if (
        t.trim() &&
        !/^\s*<(command-|local-command|system-reminder)/.test(t) &&
        !t.startsWith("Caveat:")
      )
        out.push({ id: typeof o.uuid === "string" ? o.uuid : `line-${String(i)}`, text: t });
  });
  return out;
}

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

    if (tool === "anur_search_sections") {
      const words = str(args.words);
      return words ? d.search(words) : { error: "Say which words to look for." };
    }

    if (
      tool === "anur_note_decision" ||
      tool === "anur_propose_finding" ||
      tool === "anur_drop_decision"
    )
      return decisionTool(d, tool, args, front);

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

/**
 * Decisions and findings from a plain Claude Code session (23.4, 23.11),
 * written to the committed file where the session works: the doc's repo
 * when a doc is named, else the repo or folder the session is in. A
 * decision settles only on the person's own words, as in a thread; a
 * question or an unsure one, and every finding, waits for the person to
 * agree in the chat.
 */
async function decisionTool(
  d: TerminalDeps,
  tool: "anur_note_decision" | "anur_propose_finding" | "anur_drop_decision",
  args: Record<string, unknown>,
  front: { folder: string; docs: string[] },
): Promise<ToolAnswer> {
  const cwd = str(args._cwd);
  const fromFolder = cwd ? path.relative(front.folder, cwd) : "";
  // The folder open in Anur when the session works inside it; else the session's own.
  const inside = !fromFolder.startsWith("..") && !path.isAbsolute(fromFolder);
  const base = inside || !cwd ? front.folder : cwd;
  const dir = inside ? fromFolder : "";
  const store = d.committed(base);

  const given = str(args.doc);
  let doc: { rel: string; path: string[] } | null = null;
  if (given) {
    if (base !== front.folder)
      return {
        error: `${given} isn't in the folder open in Anur; leave out doc to record it for this repo.`,
      };
    const rel = resolveDoc(front.folder, front.docs, given);
    if (!rel) return { error: `There's no ${given} in the folder open in Anur (${front.folder}).` };
    const text = await readFile(path.join(front.folder, rel), "utf8").catch(() => null);
    const section = str(args.section);
    const at =
      text === null || !section ? [] : await d.sectionPath(front.folder, rel, text, section);
    if (at === null) return { error: `There's no section "${section ?? ""}" in ${rel}.` };
    doc = { rel, path: at };
  }
  const everywhere = DecisionScope.safeParse(args.scope).data === "everywhere";
  // The part or line the files are about (23.1); the repo when they name none.
  const files = Array.isArray(args.about)
    ? args.about.filter((f): f is string => typeof f === "string")
    : [];
  const about: About | null =
    !doc && !everywhere && files.length
      ? (d.about ?? aboutFiles)(base, filesFrom(base, cwd ?? base, files))
      : null;
  const where = everywhere
    ? "every project"
    : doc
      ? `${doc.rel}${doc.path.length ? ` › ${doc.path.join(" › ")}` : ""}`
      : about
        ? about.kind === "part"
          ? `the ${about.on} part`
          : `the line ${about.on}`
        : "this repo";

  if (tool === "anur_drop_decision") {
    const id = str(args.id);
    if (!id) return { error: "Give the id Anur gave when it was recorded." };
    await store.drop(doc ? doc.rel : path.join(dir, ".anur-here"), id);
    return { text: "Taken back. It no longer reaches anyone's agent." };
  }

  const confirmed = args.confirmed === true;
  const ref = `term-${randomUUID()}`;
  let entry: KeptEntry;
  if (tool === "anur_note_decision") {
    const quote = str(args.quote);
    const decision = str(args.decision);
    if (!quote || !decision) return { error: "Give the person's exact words and the decision." };
    const said = personSaid(cwd ? await (d.transcript ?? latestTranscript)(cwd) : null);
    const rule = settleRule(quote, typeof args.confidence === "number" ? args.confidence : 0, said);
    if (rule.kind === "refuse") return { error: rule.reason };
    if (rule.kind === "propose" && !confirmed)
      return {
        text: `Not recorded yet: ${rule.why === "question" ? "their words read as a question" : "it may be a one-off"}. Ask the person in one line whether to keep "${decision}" as a decision; if they say yes, call again with confirmed: true.`,
      };
    entry = {
      kind: "decision",
      decision: decision.slice(0, 400),
      quote: quote.slice(0, 600),
      instead: str(args.instead)?.slice(0, 300) ?? null,
      until: str(args.until)?.slice(0, 200) ?? null,
      who: await d.me(),
    };
  } else {
    const claim = str(args.claim);
    if (!claim) return { error: "Give the finding, one claim." };
    if (!confirmed)
      return {
        text: `Not kept yet: ask the person in one line whether to keep "${claim}" for later work on ${where}; if they say yes, call again with confirmed: true.`,
      };
    entry = { kind: "finding", claim: claim.slice(0, 600), source: str(args.source) };
  }
  // How far it reaches (18.3): the repo by default, a doc's section with a doc, or everywhere.
  const scope = DecisionScope.safeParse(args.scope).data;
  const id =
    scope === "everywhere"
      ? await store.keep(doc ? doc.rel : path.join(dir, ".anur-here"), "", ref, entry, "everywhere")
      : doc
        ? await store.keep(doc.rel, doc.path.join(" › "), ref, entry, scope ?? "section")
        : await store.keepFor(dir, ref, entry, about);
  if (!id)
    return {
      error:
        "Anur couldn't tell whose file to write: set git's user.email in this repo, then try again.",
    };
  return {
    text: `Recorded on ${where}, in .anur/decisions/ so it's committed with the code and reaches the team's agents. Tell the person in one line. To take it back, call anur_drop_decision with id ${ref}.`,
  };
}
