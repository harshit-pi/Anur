/**
 * The `/anur` skill Anur installs into the person's Claude Code (6.1), as
 * files under `~/.claude/skills/anur/`. Anur keeps the installed copy equal
 * to this one (6.3): a changed or corrupted file is rewritten on launch.
 */

const SKILL = `---
name: anur
description: Turn this chat into a doc in Anur, start a doc of headings in Anur, or open a file in Anur; and record the person's lasting decisions and kept findings so the team's agents follow them. Use when the person types /anur doc, /anur new or /anur open, asks to put this conversation into Anur, or makes a decision that should outlast this task, such as correcting what you did.
---

# Anur

Anur is the person's app for docs that are thought through section by section. It is open on their computer, with a folder of Markdown docs. Reach it through its MCP tools, whose names start with \`anur_\`. If a tool says Anur isn't open, ask the person to open Anur, then try again.

## /anur doc

Turn this chat into a doc, so the person can keep thinking about it section by section.

1. Draft the doc from what this chat discussed: a title as an H1, a heading for each topic the chat settled or explored, and under each a first draft in plain Markdown of what was decided or proposed. Write open questions as open questions. Add nothing the chat didn't say.
2. List the inputs you used in this chat: files you read, pages you fetched, commands you ran, results from other tools. Give each its path, address or command.
3. Write a summary of the chat in five to ten lines: what was discussed, what was decided, what is still open.
4. Call \`anur_create_doc\` with a file name, the Markdown, the summary and the inputs. Anur saves the doc in its open folder, keeps this chat on the doc's title, and opens it.
5. Tell the person the doc is open in Anur, in one line.

## /anur new

Start a doc of headings only. Call \`anur_create_doc\` with a file name and Markdown of a title and the headings the person gave, or that the chat suggests, each with no text under it. Leave out the summary and inputs.

## /anur open

Open a doc in Anur. Call \`anur_open\` with the doc's path, the one being discussed if the person names none, and the heading of the section being discussed, if there is one.

## Reading and proposing

While the person works in a doc, these help:

- \`anur_outline\`: a doc's headings, with each section's ID and how many threads it has.
- \`anur_section_bundle\`: what a thread on a section starts with: the text above it, the section, and the rest of the doc.
- \`anur_list_threads\`: how many threads each section has, and whether any is running.
- \`anur_propose_preview\`: propose new text for a section. It shows in Anur as a proposed edit; the person decides. It never changes the file.

## Decisions and findings

Whatever you're working on, record what should outlast this session, so the team's agents follow it. It's committed with the code in \`.anur/decisions/\`.

- When the person makes a lasting decision, such as a choice about the work or a correction of what you did ("no, three retries, not infinite"), call \`anur_note_decision\` with their exact words as the quote, the decision as a statement of at most 7 words, in no one's voice, and how sure you are it's lasting. Leave out \`doc\` for the repo you're working in, and pass the files the work touched as \`about\`, so it lands on that part of the system. If it reverses a decision already in \`CLAUDE.md\`, pass that decision's words as \`against\`: both then stand until someone picks. If Anur says to check, ask the person in one line, and call again with \`confirmed: true\` only if they agree.
- When you establish a fact later work here should know, ask the person whether to keep it, and if they agree, call \`anur_propose_finding\` with \`confirmed: true\` and its source.
- Tell the person in one line what was recorded. If they want it gone, call \`anur_drop_decision\` with the id Anur gave.
- Don't record one-off instructions for this task, questions you answered, or your own choices or assumptions: a decision is what the person said should hold, or their correction of what you did.
`;

/** Each file, by its path under the skill's folder. */
export const SKILL_FILES: Readonly<Record<string, string>> = { "SKILL.md": SKILL };
