# Decisions

Engineering decisions made while building Anur, newest first, each with why. The product design lives outside this repo; this file keeps what a session working in the code needs to know without it. When a decision changes, edit its entry and say when.

## What a thread reads (2026-11-17)

- A thread on a section gets: the own text of every section above it, its own section in full (subsections included), and **the rest of the doc in full**, every other section's heading and own text.
- Past a budget, about a third of a 200,000-token context window (`FULL_TEXT_BUDGET`), the rest falls back to an outline, each section's heading and first line, and the header asks the agent to read, with `anur_read_section`, any section that could set a rule for its answer.
- Another thread's chat is never included. Decided text is the current doc, so it isn't pollution; discussion is.
- The parts are chosen by `BUNDLE_RULES` in `packages/core/src/context/bundle.ts`, held as data: `ancestors-own-text`, `section-subtree`, `doc-full`, `fetch-hint`. `doc-outline` and `siblings-outline` stay as variants for the eval.
- Why full text: the context eval's outline-only bundle lost a rule written past a section's first line every time; full text and an outline with a fetch hint each kept it every time, and full text needed no extra calls.
- Because a thread may read any decided text, Claude Code reading the whole working copy before an Edit is accepted, not worked around. The alternative, a working copy holding only what the thread was given, would need a partial file stitched back into the doc and would stop edits to sections outside it.

## The context eval's first result (2026-11-17)

- Three runs each way, Anur's threads against one long chat (`evals/context/results/2026-11-17T23-05-11-236Z.json`).
- An option rejected in one section's thread reached a sibling's draft in the long chat once ("never WhatsApp") and never in Anur's threads.
- Constraints in the title's own text and in a further section's first line were kept every time, both ways.
- A constraint past a further section's first line was kept every time in the long chat and never in Anur's threads: the outline carries first lines only, and the eval gives the agent no tools to fetch more.
- What to change in the bundle in answer is open; see the decision that follows this result.
- Second result, five runs each way (`evals/context/results/2026-11-17T23-24-06-575Z.json`): the deep rule was kept 5/5 with the rest of the doc in full (`doc-full`) and 5/5 with the outline plus a hint to fetch (`fetch-hint`, with `anur_read_section`; 3 to 4 reads a run), against 0/5 with the outline alone. No way leaked the rejected option this time, so the eval needs harder pollution cases to tell the ways apart there.

## Agents sit behind an adapter (2026-11-17)

- The agent host speaks ACP to every agent the same way. An `AgentAdapter` (`src/agent/adapters.ts`) says only how to start that agent's ACP adapter and how to put Anur's guard into that agent's own settings. Claude Code is the only adapter.
- A thread belongs to Anur, not its agent: its section, bundle and every message are kept in `.anur/`. Each session line records its agent. Moving a thread to another agent starts a new session there, rebuilt from the bundle and the chat.
- Codex and Gemini CLI are listed but can't run threads until their ACP adapters offer a hook before tool calls, since Anur's guard depends on one.

## Threads run the person's own agent, guarded (group 3)

- The agent host runs in its own `utilityProcess`, an ACP client of the person's own install; `CLAUDE_CODE_EXECUTABLE` is always set, or the adapter runs the copy bundled in its SDK.
- Claude Code and the PATH are read from a login shell: an app opened from the Dock doesn't get a terminal's PATH.
- The guard is a command hook plus deny rules, sent in the session's settings: command hooks are the only kind that cross ACP.
- The hook blocks `.anur/` (other threads live there), recursive reads that would reach it, `git clean -x`, and shell writes to docs. It sends every read and edit of a doc to the thread's working copy.
- **The thread check** must pass before and during every turn: the hook passes sample calls in a throwaway folder before an agent connects; each session's start hook checks in before the first prompt, resumed ones included; every tool call the agent reports done must appear in the hook's log. A miss stops the turn and that agent's threads.
- Anur's MCP server is a small stdio program the agent starts per session, given its thread's token in its environment. It reaches Anur over one Unix socket in a 0700 folder; requests without a known token are refused.

## Edits arrive as previews, applied by a person

- A turn works on a working copy of the doc, outside the folder: the doc with the thread's preview already made. The doc changes only when a person applies.
- When the turn ends, the agent's own changes to the copy (end against start) are merged three-way onto the doc as it is then, newer typing included, and become the thread's preview, one part per section, each holding the text it was made against.
- The copies are watched for ten minutes after a turn, so edits made by background work still reach the preview.
- A preview shows in place on its section and follows newer typing; where the person changed the same lines, they choose: ask the thread again, or take the thread's version.
- Apply merges the part onto the section as it is now, writes its version to History first, then lands as one editor transaction tagged `apply`, with Undo.

## The file is the truth

- Markdown files are the truth; `.anur/` only adds to them. Deleting `.anur/` never loses a doc.
- While a doc is open, only its editor writes the file; every save is a compare-and-swap on the file's hash.
- Every line Anur writes in `.anur/` has its own ID, and every file that changes often has one writer, the device in its name, so sync never makes a conflict there.

## Images (2.27)

- The page is sandboxed, so main finds and reads images and hands them over as data URLs; the page's CSP allows `data:` images and nothing remote.
- Images are found as Obsidian finds them, and pasted images are saved where Obsidian would put them, named as Obsidian names them, so a folder opened in both apps agrees.

## The map (7)

- The map is drawn from the headings: the title in the middle, its sections split right and left by height, children further out. Box sizes come from the text, never the screen.
- Moving a box works as on a whiteboard (Excalidraw, draw.io): it stays where it is dropped, and the file never changes. Boxes nobody moved follow the layout; Tidy puts moved ones back.
- Positions are kept by section ID in `.anur/docs/<doc>/layout/<device>.json`; across devices the newest file wins per section.
- The page stays mounted under the map, so a section added on the map goes through the editor like typing, with Undo.
- A box is always a section: a box drawn from another's handle is a subsection of it. An arrow dropped on another box is a link, `[[#Heading]]` at the end of the source's text, so the file holds it and the map draws every same-doc link as an arrow.
- Delete on the map removes the section with everything under it. ⌘Z on the map undoes the map's own steps in order: box moves are kept by the map, edits to the file are undone through the page's history.

## Writing in Think

- Think's section text is a second CodeMirror view of the page, not a copy: each keystroke is forwarded to the page as an edit at the section's place, so the page stays the only writer of the file, and ⌘Z there undoes in the page's one history.
- Edits made on the page, by Apply or by undo show in Think as they land; the section's place is mapped through each page change and taken again from the parse when the outline refreshes.
- The heading is edited in place too; only its words change, never its level or marks.
- It looks as the read-only text did: no box, no white field.

## Options, not edits (trial, not merged)

- A thread brainstorms; it doesn't edit by default. When the agent has alternatives for its section it offers them with Anur's `anur_offer_options` tool, each a title and the section's whole new text. It edits the working copy only when the person asks.
- Options live in the thread's record (`options`, `option-used` lines), never in the file: cards in Think, dashed boxes off the section on the map.
- "Use this" replaces the section's own text through the page (one ⌘Z takes it back); "Add as subsection" puts it under the section with its title as the heading. The thread remembers the pick, and the map drops that set of options.
- Claude uses its judgment: it answers questions, offers options when there's a real choice (even unasked, as for "make this sharper"), and edits when asked or when the change is clear. It says an edit is ready to use, never that the doc is updated.
- An edit is shown as one more option: a card in Think ("Edit to Pricing", Use this, Show on page, Set aside) and a dashed amber box off its section on the map; the page shows it in place, and its button says Use this too.
- Explore this works an option through before picking; options found while exploring nest under it, on the map and in Think ("Within …").

## Inputs (4.3, 4.4)

- An input is what the agent picked up with its own tools, read from each finished tool call: a file (its contents as on disk), another doc (a pointer, read fresh), a command's output, a fetch's answer or a search (both untrusted), another MCP server's result. Anur's own tools, edits, and the thread's own doc or working copy are not inputs.
- Content is a snapshot in `.anur/snapshots/` by hash; the thread holds `input` lines. A removal is an `input-removed` line, so the input never returns.
- A new thread receives the inputs of threads on its section and every section above it, never a sibling's; its bundle lists them by name, and it reads them with `anur_list_inputs` and `anur_read_input` (files and docs as they are now, with a note when they changed).

## Ask (4.8) and bases (4.11)

- Ask is a thread on the doc's title, whose subtree is the whole doc; it opens from the tab bar or the palette.
- An embedded base reaches the agent as its table(s), in place of the embed line, counted in the budget.

## Panels

- The outline sits under the file tree in the left panel, folding away, and marks the section in focus. The right panel is Think alone, with no tabs; History returns inside Think when section history is built.

## Start from your chat (group 6)

- Anur adds itself to the person's Claude Code only on their Add: the `/anur` skill in `~/.claude/skills/anur/`, and its MCP server registered through `claude mcp add-json --scope user`, so Anur never edits Claude Code's config by hand. `CLAUDE_CONFIG_DIR` is honoured, as Claude Code does.
- Every launch checks the install: a skill file whose hash differs from the app's (an update, or corruption) is rewritten, and a registration pointing at an old path is replaced. Remove is remembered; nothing comes back after it.
- An agent in a terminal reaches Anur with a terminal token, written each launch to a file only the person can read. Its tools work on the folder in Anur's front window: outline, section bundle, thread counts, a proposed edit (shown as "Proposed from your terminal"), make a doc, open a doc.
- `/anur doc` keeps the chat on the new doc's title: the agent's summary as the thread's first message, the Claude Code transcript and the inputs it used as inputs, carried to every section.
- Quitting cleans up once (sessions, threads, socket, folders, at most four seconds), then exits: a second quit from inside will-quit wasn't always honoured.

## Never worse than Obsidian; agents' edits as they land

- **Rule:** an agent in Anur can do anything an agent in Obsidian's plugins can. Anur changes how an edit lands, never refuses it. Only Anur's own data (`.anur/`, other threads' copies) is off limits.
- A doc written from the shell or a script during a turn isn't refused. When the running thread's own tool call named that file, Anur adopts the write: put back and made the thread's proposal, or kept and noted with Undo when the setting is on. Anything else (a person editing in Obsidian meanwhile) stays a "changed while running" note with Revert.
- Settings, Agent, "Use agents' edits as they land", off by default: an open doc's page uses each new edit through Apply; a closed doc's file is changed by main, History first. Each is noted in its thread ("Used as it landed"), with Undo while the app runs; clashes with typing stay proposals; options are never picked for you. Terminal agents' proposals follow it too.
