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
