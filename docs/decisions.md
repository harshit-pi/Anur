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
- A doc written from the shell or a script during a turn isn't refused. When the running thread's own tool call named that file, Anur adopts the write: put back and made the thread's proposal, or kept and noted with Undo when the setting is on. Anything else (a new file, git, a person editing in Obsidian meanwhile) is left as it landed, with no note on the thread: the warnings were noise, and History still holds the doc's earlier text (2026-11-18).
- Settings, Agent, "Use agents' edits as they land", off by default: an open doc's page uses each new edit through Apply; a closed doc's file is changed by main, History first. Each is noted in its thread ("Used as it landed"), with Undo while the app runs; clashes with typing stay proposals; options are never picked for you. Terminal agents' proposals follow it too.

## Threads, organised

- The whole-doc thread is Anur's mark (the app icon's diamond), not "Ask", and boxes ask "What should we do with this section?": an agent does things, not only answers.
- A thread names itself after its first reply (`anur_name_thread`, two to five words); a name the person gives always wins.
- A section's threads group by what they need: Needs you (options to pick, an edit to use, a question waiting), Running, then Done, folded. Other sections' threads fold under "Other threads in this doc", by section. Map boxes and that fold show an amber dot when something needs you.
- A new `.anur/` is committed with git by default; a `.gitignore` of "*" is how a folder opts out.

## Actions: build and check a section (group 15)

- Two actions on any section, under the message box: **Build this section** and **Check this section**. Each is a thread tagged Build or Check, in the list and on the map; the person's message reads "Build this section", while the agent gets Anur's instruction.
- Both run in the mode the person picked, as any thread does: Anur adds no approval Claude Code wouldn't ask for (rule: never worse than Obsidian or Claude Code). In plan mode, Claude Code's request to leave it carries the plan, shown as a card: Approve and build, or Keep planning.
- Build does what the section decides with the agent's own tools. A message to a person is a draft, never sent. The reply lists each change by its path in the folder, then guesses marked as guesses; the section's text gets a "Built" line as a proposed edit.
- A doc the agent makes is kept in the folder as made, not proposed: there's nothing to compare it to. The thread notes "Made FAQ.md" with Undo, which removes it while it's as the agent left it. Revisions within the turn update it in place. The hook sends a new doc's write to the working copy without copying anything first.
- Check reads only and reports with `anur_report_check`: each claim holds, is wrong, is unsupported or is missing, with its source and a note, shown as a table. Corrected text becomes a proposed edit.
- An edit a thread proposes to another doc shows on that doc's page, and the thread says so ("Proposed an edit to Plans in Pricing.md", with Open). Text the agent writes after a tool call starts a new paragraph.
- Anur's own tools never ask the person for permission, in any mode, and show by what they do ("Named the thread"), not their ids.

## The map, read top down

- The map is a tree read top down: the title at the top, each box's sections in a row beneath it, a thread under its section, and the thread's options and edits under the thread. Rows line up by depth.
- Every box has a second line saying what's under it ("4 sections", "1 thread") or what sets it apart: an option's one-line why (`anur_offer_options` now asks for it), "Exploring…" while the agent works on it, an edit's first line.
- A thread is a pill that reads as its name, in the doc's italic. A proposed edit has Use on its box, which puts it in the doc as Use in Think does.
- A wide map opens at 75% on its title, so names stay readable; Fit shows the whole of it.

## Starting a thread faster

- Anur keeps one Claude Code session open ahead, on the default agent, under a thread ID it reserves. The next thread (a message, Build or Check) takes it and skips the session's start, about a third of a second; a new spare opens behind it. An untaken spare is closed with the folder.
- The rest of the wait before a first action, one to two seconds, is the model's, as in Claude Code.
- A running turn shows "Thinking…" for ten seconds, then how long it has been working ("Working for 4 min 12 s…"), so a long build doesn't read as stuck.
- A thread's mode and model pickers show their values, as a new thread's do.

## Inputs: reads only, and the machine's own stays on it

- Only reads become inputs: files, pages, searches, other MCP servers' answers, and shell commands made only of reading programs (cat, ls, rg, git log…) with nothing written to a file. Commands that write, run, build or test are the agent's own work, and reading back a file the thread wrote brings nothing in.
- What came from the person's machine outside the folder (a file, a command's output, another MCP server's answer, the chat behind `/anur doc`) keeps its content in Anur's local app data, never `.anur/`, which is shared and often committed. The input line keeps its label and hash, marked `local`; another person's agent sees it exists and reads it again itself. Think marks it "kept local".
- Build says first, in one line, what it will build and what it relies on, so the person can stop it early. On a section with several steps it builds the first that fits one sitting and lists the rest as next steps.

## Steps folded, as in Claude's apps

- A run of two or more tool calls shows as one line ("▸ 7 steps · Edit working copy of Launch.md") that opens to list them. Failures are counted on that line; a doc edit Anur sent to the working copy isn't one.
- While a turn runs, the line under the steps says what it's doing now: "Working for 1 min 12 s · Write pitch.md".
- What the agent writes before a step is saved as its own message, where it was written, so a reloaded thread reads as it ran: a note, its steps, the next note, the report.

## Links as context (group 8)

- A link index in main parses every doc's wiki links, by modified time, so a doc is parsed again only when it changes; the open doc's links come from its page. Docs still in iCloud are never read. (The design put this in an index process; main is enough at today's folder sizes.)
- Only the links in a section's own text count, not its subsections' (each has its own threads), so a doc's title doesn't gather every link in the doc, "Related" lists included. Each link is taken once. There's no count cap: the budget bounds the size.
- A thread's bundle carries the sections its section links to in other docs, one link deep: a heading link brings that section with its subsections, a doc link brings the doc. What doesn't fit the budget left after the doc is named with its path; links that go nowhere are named as broken. Links within the doc aren't repeated: the bundle has the doc.
- Think lists a section's links ("A new thread here reads these too") and, folded, the sections that link to it, each once, each opening where it is. `anur_links` gives threads and terminal agents the same, as paths.
- A link to a missing doc is faded on the page and in Think, as in Obsidian. On the map, a link to another doc's section is a small box under its section that opens it.

## History and Restore (group 5)

- Think shows a section's History, folded: its versions newest first, from every device, each with when, its cause (typed, from a thread, changed outside, restored, first seen) and a one-line summary read from the change itself ("Changed “£4” to “£3”", "Added 2 lines").
- In a git repo, the commits that changed that section are listed too, each with the section's text then; reading them never writes.
- A version opens to its text against now: amber for what only it has, struck through for what only now has. Restore puts it back into that section only, as one change ⌘Z undoes, recorded as a "restore" version; anything typed before it is recorded first, so no text is lost. A version from a thread opens that thread.

## Change sets (group 9)

- A thread whose edits touch more than one section or doc shows one bar at the foot of the chat, above the reply box: "3 edits in Plan", with Use all 3. Each edit has its own card above it. With "as they land" on, the bar counts only edits kept as proposals, and a line above the reply box says edits apply as they land, with a Change link to Settings.
- Use all uses the open doc's edits through its page, going round again while any lands (an edit to a section and one to its subsections overlap), then every other doc's in its file, doc by doc. What clashed with the text stays a proposal and is named. One "Used all" note in the thread holds one Undo; it is one short line ("Used 5 edits in Plan"), and earlier ones fold to a link.
- Undo goes back by a three-way merge per doc, so typing made since stays; the open doc goes back through its page, so ⌘Z covers it. A doc that clashes is named and left for its History.
- A new doc an agent makes is kept with Undo (15.6) rather than shown as a new-doc preview.
- The working line under a thread's steps gives only the time; the steps line already names the step.

## The check card, problems first

- A check's card leads with what needs a look: "Of 13 claims, 2 are wrong, 1 is missing", then those claims, wrong first, then missing, then unsupported. Claims that hold fold into one line. Each claim is its verdict and the claim on one line, with a short note under it; the source shows on hover. A link points to the corrected text when there is one.

## A wide map wraps; links are a badge

- A parent's children sit in rows of at most four, wrapping in reading order, so a doc with many sections grows down rather than endlessly sideways and opens readable. Lines run as a trunk from the parent, a rail along each row and a short drop to each box, with a spine down the left joining the rows; a dragged box goes back to a curve.
- A section's links to other docs are one badge on its box ("→ 6"); a click lists them, each opening where it is. The list opens upward from a box low in the view.
- Think no longer repeats the section's text under its heading: the page shows it, and so does hovering a map box. It sits behind `SHOW_SECTION_TEXT`, off, to turn back on if missed.

## Findings (16.1, 16.2)

- A finding is a claim a thread established, with its source. The agent proposes one with `anur_propose_finding`; the person keeps it (reworded if they like) or drops it. Only kept findings carry: to every new thread on that section and the sections under it, listed in the bundle with their sources and marked settled unless a source read now contradicts one.
- A Check's wrong or missing claims each offer "Keep as a finding", which keeps what the source says.
- Think lists a section's kept findings under Context and history, each with × to drop it.
- Not carried: unkept proposals, and conclusions in a thread's chat. A wrong finding carried forward pollutes with authority, so a person always decides.

## The head-to-head eval (16.5), and a cap on the doc in full

- Three tasks on a 2,300-line doc with rules elsewhere, a stale archive and decoy docs, scored by script, three runs each (evals/head-to-head). Anur 0.98, Claude Code fresh 1.00, Claude Code after six unrelated tasks 0.96 with one stale fact; quality sits near the ceiling for all three.
- Cost told them apart: Anur sent the whole doc in every bundle, about 153k weighted tokens a task against Claude Code's 65k. With the rest of a doc sent in full only up to about 15k tokens (`DOC_FULL_MAX`), and as an outline past that, Anur scored 1.00 at 62k, with the fewest steps.
- 16.3 (inputs given in full) is dropped: the eval shows the agent reads what it needs, and more in the bundle costs more for nothing.

## The long-chat eval

- One Claude Code chat worked through 40 tasks across the decoy docs (about 790k tokens of context by the end), then each target task ran three times in a fork of it.
- Quality held: 0.96, no stale facts, one miss (a correction left out). Cost did not: 156k weighted tokens a task against Anur's 62k, as every step re-reads the afternoon's context. Anur's measured edge is cost and speed in long sessions, not fewer mistakes.
- The grader no longer counts quoting a doc's old figure, to correct it, as using a stale fact.

## Orphans, closing and Clean up (group 11)

- A section whose heading is gone keeps its threads and history under Orphaned in Think, with the live section most like it suggested by its last text and heading. Reattach moves its threads and history there; Delete removes its threads, their previews, its inputs and its history at once, after a confirm. Only orphans with something behind them are listed.
- Every lookup of a thread's section follows Reattach and alias links, so a reattached thread shows on its new section and its versions join that section's history.
- A thread can be closed (hidden; "Show closed" brings it back) or deleted with a confirm. A running thread can't be deleted.
- Each device writes `.anur/open/<device>.json`: when it opened the folder and when it last quit cleanly.
- Settings, Storage lists what `.anur/` holds by kind. Clean up removes only snapshots older than 30 days that no record names, searching every record for the hash so a kind this app doesn't know still keeps its snapshot. It is off while another device has the folder open or didn't quit cleanly; a device gone over 30 days no longer counts.
- Unused attachments: images, and files attached as inputs whose input was removed, that no doc names. Listed for review; each goes to the system Trash only on a click.

## Who started a thread, only when it isn't you

- A thread someone else started shows their name: beside the time in the list, "started by Duy on 18 Nov" under its title, and over each message they wrote. Your own threads and messages show no name, so the screen is unchanged until someone else's work arrives.
- Each device writes its person's name into `.anur/open/<device>.json`: the name set in Settings → General, else git's `user.name` for the folder, else the Mac account's full name. A thread is yours when its device is this one or its device's name is yours, so your other Mac's threads count as yours too. A device with no name yet shows as "Another device".

## Before sharing: the answer first, plain steps, and why on the first screen

From a first-run walkthrough on real Claude (Ask, Check and Build on a launch plan):

- A finished turn's reply leads it. The agent writes its answer last, after the findings and options it made, so Think moves the reply above the turn's first card and the cards follow under "From this answer". A running turn stays in the order it arrives. This is display only; no prompt asks the agent to answer first, which it couldn't do reliably before reading.
- Steps read as what they did ("Read competitors.txt, beta.csv and 1 more", "Searched the folder"), never the raw command with the folder's full path. The summary doesn't say "failed": the agent usually recovers, and a failed step still shows × when the steps are opened. A turn that failed shows its own error.
- Steps a card stands for (proposing a finding, offering options, reporting a check) are hidden; the card is the record.
- The start page and the tour's second step say why in one line: a thread starts from its section, the rules it links to and what earlier threads settled, not a blank chat.
- The "Use Anur from Claude Code" card waits until a thread has answered on this device, so it never greets someone who hasn't seen Anur yet.

## Decisions: a finding a person stands behind

- A decision is a finding whose source is a person, not a file: their exact words from the thread, the decision in under 15 words, what it replaced, and any "until". People see "Decided"; findings stay "Finding". No other kinds are shown (models confused override and decision 40% of the time in the 2026-11-18 eval).
- The agent records one with `anur_note_decision`. It settles with no click, shown as one line with Undo, only when the words are word for word in something the person typed in that thread, they aren't a question, and the agent's confidence is 0.7 or more (Opus at 0.7 kept 92% right on 286 real messages). Otherwise it asks once: "Keep this for later work?", Keep or Just this once. Words the person never typed are refused, so nothing is put in anyone's mouth.
- Kept decisions reach every new thread on the section and below, listed apart from findings as "Decided by Sam (3 Nov): … Instead of: …". The agent is told to follow them, to say in a line when it relied on one, and to ask rather than go against one.
- Names show only on someone else's decisions. In a real run, a new thread asked to cut the price below a competitor answered "No. On 18 November Harshit decided…".

## The plugin API (group 19)

- Six points, in `packages/core/src/plugins`, headless so the app, the pre-commit hook and CI share them: section source, edge detector, context provider, map layer, surface, MCP tools under a prefix.
- Each point runs in one process: detectors and section sources in the index process, context providers and surfaces in main, map layers in the renderer, MCP tools in the MCP server. A plugin loads in each process, and each host keeps only its own points.
- A manifest declares `apiVersion`, the points, the MCP prefix, the surfaces and the folders. Every registration is checked against it, and an undeclared one fails the load and leaves nothing behind. Network and file access aren't enforced until a sandbox exists (Design - Extensions).
- Plugins Anur ships are switched on per folder, remembered on this Mac, in Settings → Plugins. Context providers add labelled lines to a thread's bundle; MCP tools reach the agent through the session's MCP server.
- Engineering is the first plugin, declared but empty until group 20. Core's own features move behind the API after the first week (group 27). Section sources and map layers are wired into the page and map when the engineering plugin first draws something.

## Repos and parts (group 20, first part)

- The scanner lives in a new package, `@anur/system`: headless Node, with no Electron, shared by the app, the pre-commit hook and CI. `@anur/core` stays free of the file system, as it says it is.
- A repo is any folder with `.git`, at any depth. Its ID is the oldest root commit's hash, read from a committed `anur/repo.json` when present, so shallow clones and CI agree; otherwise from git, and written there with `--pin`. A shallow clone without the file says so and has no IDs.
- Parts come from build files by rule: `package.json` (except a monorepo's root that only lists workspaces), `pyproject.toml`, `go.mod`, `Cargo.toml`, `serverless.yml`, and CDK stacks from the `cdk.json` app, in TypeScript or Python, across lines. A stack name built at run time is left out.
- A part's ID is the repo's ID plus the declared name, never a path. A move keeps it; the same build file with a new name keeps it as a rename; two parts with one name add their folder. A known part not found again is orphaned, with the same name elsewhere suggested.
- Failures are shown, never fatal: conflict markers, bad JSON, a nameless package. Two clones of one repo are shown once: the one named as on GitHub, else the shallowest path.
- On the team's own `~/workspace`, 17 repos and 150 parts; the repos without parts are Amplify backends, scripts and docs, with no build file.
- `anur-system scan <folder>` prints the system; `--json`, `--pin` and `--known <file>` are for the hook and CI.
- The engineering plugin registers the system as a section source: repos as sections, parts beneath. Still to come in group 20: the system tab, where the model's proposed names are accepted and new parts show "unreviewed", and one watcher per repo.

## Groups: one level at a time (group 20)

- No level of the system shows more than twelve boxes where a rule can help. A repo with more parts gets groups between it and its parts, as anur-living-map opens its levels.
- Groups come by rule from part names: tables, queues, storage, topics, keys and secrets, caches, monitoring, schedules, and services for the rest. A kind with one part joins services.
- A group still above twelve splits by the word most of its parts share, then the next, plural or not; parts sharing no word go to "Other".
- Groups are a view: a part's ID and path never change with them. The model's proposals (20.6) may rename or merge them, accepted by a person.
- On the team's largest repo, 103 parts become eight groups; its biggest, services (37), opens to seven, of which "Other" still holds 13 for the model to name.

## The system tab (group 20)

- The system shows in a tab of its own, with the fixed path `anur:system`, so tabs, back and forward work as for docs. It opens from a ribbon button and from ⌘K, both shown only while Engineering is on for the folder.
- Repos, then groups, then parts, one level per click; a trail goes back. Repos sort by name, ignoring case, with those that have no build file last.
- Section sources run in a new index process, a `utilityProcess` with its own plugin hosts, as Internals §2 says, so a scan never freezes main. A full scan of the team's 16 repos takes about 1.4 s.
- Still to come: the model's proposed names and merges, with Accept and Rename (20.6, 20.6a), "unreviewed" on new parts (20.6b), and a rescan by watcher instead of the Rescan button (20.8).

## Watching repos (20.8)

- One recursive watcher per repo, in the index process, started the first time the system is read. A change matters when it is a build file or a `.ts` or `.py` file (a CDK app names stacks) outside `node_modules`, `cdk.out` and dot-folders; the rest of the tree is ignored.
- After 300 ms of quiet the index process tells main, main tells the windows with that folder open, and the System tab reads the system again; a rename shows in under a second.
- Section sources may now watch: `SectionSource.watch(folder, onChange)` returns a stop. A source whose plugin is switched off stops watching.
- Symbols in the SQLite cache move to group 22, where edges first need them.

## Claude names the groups (20.6)

- When the System tab first reads groups Claude hasn't seen, main asks the person's own agent once: a fresh session outside any thread, no tools (every permission ask refused), closed after one answer (`Threads.askOnce`). On the team's two biggest repos it took 17 s.
- Claude gets each group's repo, own name, the groups it sits in, and up to 40 part names. It replies with JSON: a name, and sibling groups to merge. A name given as a path keeps its last step; a merge across levels is dropped.
- Every group asked about is written as a proposal, so none is asked twice. A proposal that keeps the rule's name and merges nothing is settled at once, so the person sees only real suggestions.
- The person answers on the group's box: Accept, Rename or Keep (20.6a). Any group can be renamed. Answers are lines in `.anur/system/review.jsonl`, keyed by the group's section ID, applied over the rule's groups by the engineering plugin, so regrouping never mints IDs.
- Parts the person hasn't seen say "unreviewed" (20.6b). Accepting or renaming a group counts its parts as seen; "Mark N reviewed" does so for a level.
- A failed ask, such as no sign-in, says why with Try again, and isn't retried on its own.

## The change report, headless (21.2, 21.3a)

- Task boundaries come from Claude Code's own hooks: `anur-system hook` runs on `UserPromptSubmit` and `Stop`, reading the hook's JSON on stdin. It always exits 0, so a hook never fails the agent.
- At a prompt, every repo in the opened folder is marked: its HEAD, and each dirty file kept as a blob. At Stop each repo is compared with the mark, so only what changed during the task counts: commits made during it, files left uncommitted, new and deleted files, in any repo, not just the session's own. A file already dirty and untouched is not the task's.
- A Stop that changed nothing writes no report. Reports go to `.anur/tasks/<id>.json` in the opened folder: the outermost folder holding `.anur/` below the home folder, so a repo inside a folder of repos reports to that folder.
- Categories by rule, the first that matches of data, auth, calls, UI, else other. Data: migrations, schema and model folders, `.sql`, `.prisma`, and added lines that create or alter tables or columns. Auth: paths naming auth, session, token, login, OAuth, JWT or permissions, and imports of them. Calls: added HTTP-client calls (fetch, axios, got, requests, httpx, http.request and the like), until edges arrive. UI: `.tsx`, `.jsx`, `.css` and the like.
- Each line names its repo, its part (the nearest build file's folder; a package over the CDK stacks beside it), the file, and the first changed line and its text.
- Still to come in group 21: the report in the app's task tab with at most three lines before "more", Claude's choices from its own report, and putting the hook into Claude Code.

## The change report in the app (21.3, 21.4)

- The hooks ship as Anur's own Claude Code plugin, `anur`, in a local marketplace (`anur-app`) that Anur keeps in its app folder; Claude Code reads it in place. Settings → Plugins → "Task reports in Claude Code" adds it at user scope through `claude plugin marketplace add` and `claude plugin install`, and Remove takes both away. Anur never edits Claude Code's settings itself, and a launch rewrites plugin files that no longer match the app.
- A shell guard runs first: outside folders holding `.anur/` (below the home folder) it drains stdin and exits, so prompts elsewhere cost a few milliseconds.
- The prompt hook adds one line of context asking Claude to end a task with "Choices:" and a bullet per choice nobody asked for; the Stop hook reads that list from the transcript's last reply. Nothing is inferred: no list, no choices. On a real `claude -p` task, Claude listed two.
- A report's line points at the first added line with words, not a blank one.
- The System tab lists the five newest reports; one opens in its own tab, `anur:task/<id>`, titled "Task report" in the path row. The tab shows at most three items before "more", ranked data, auth, calls, Claude's choices, UI, other, each with its file and line. With no decisions, it shows the same.
