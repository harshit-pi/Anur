# Spaces, homes and `.anur/`

Three different things share one folder name. Mixing them up is how a parent folder once became a git repo over its own child repos, so read this before changing how folders open, what's committed, or what a plugin acts on.

## The three

| Thing        | What marks it                                                                | What it is                                                                                                                                    | Committed                                   |
| ------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Space**    | `.anur/space.json` at its root                                               | The folder a window works in. It gathers every `.anur/` inside it, its repos' too. Its plugins and Git act on it alone. One per window.       | **Never.** Each Mac chooses its own spaces. |
| **Home**     | A folder inside a space with `.anur/` or `.git`; the space's root is one too | Where a doc's threads, decisions, section IDs and history are kept: the nearest home above the doc (18.15). A repo's home goes with the repo. | Yes, with its repo                          |
| **`.anur/`** | The folder itself                                                            | What Anur keeps beside a home's docs: the files listed below.                                                                                 | Yes, but the per-Mac files below            |

**Having a `.anur/` doesn't make a folder a space.** Every repo has one, for its decisions, and a repo can be a space on one Mac and a part of `~/workspace` on another. Only `space.json` says "space". Code must never treat "has `.anur/`" as "is a space".

`space.json` stays on each Mac because the same repo is shared: committed, a teammate who cloned it into their own `~/workspace` space would get a space inside a space. A test fails if it's ever committed (`spaces.test.ts`).

## Opening a folder

- **It's inside a space**, or is one: that space opens, and the page says once "Launch is part of the anur-product space, opened there". Nothing is ever a smaller space inside a bigger one.
- **Anything else** becomes a space (`space.json` written). A space inside it stops being one, with no question asked: only its marker goes. Its `.anur/` stays as it is: its threads and decisions are read by the new space as part of it, its plugin settings sit unused while it's part of the bigger space, and opening it on its own again makes it a space again with everything it had.
- **No space sits inside another.**

The engineering workspace (`~/workspace`, many repos) is one space; its code repos are homes and parts on its system map, not spaces.

## What's in `.anur/`

| Path                                        | What                                                                                                       | Committed                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `format.json`                               | The folder's format number                                                                                 | Yes                                                     |
| `.ignore`                                   | `*`, so searches skip `.anur/`                                                                             | Yes                                                     |
| `.gitignore`                                | The per-Mac files below; a `*` line keeps all of `.anur/` out of git (Settings), decisions still committed | Yes                                                     |
| `.gitattributes`                            | Marks `.anur/` as generated, so GitHub folds it away in PR diffs                                           | Yes                                                     |
| `home-id`                                   | The home's own ID, so doc IDs are the same on every clone                                                  | Yes                                                     |
| `decisions/<person>.jsonl`                  | Decisions and kept findings, one file per person                                                           | Yes, always                                             |
| `people/<device>.json`                      | Who uses each device: handle and name                                                                      | Yes                                                     |
| `plugins/enabled.json`, `plugins/<id>.json` | Which plugins are on, and each one's settings                                                              | Yes, unless that plugin's settings are kept on this Mac |
| `docs/<doc-id>/…`                           | Threads, inputs, previews, section IDs, history, map layout                                                | Yes, unless a public repo's owner chose not to (18.13)  |
| `snapshots/`                                | Files and pages a thread read, by hash                                                                     | Yes                                                     |
| `system/review.jsonl`, `tasks/`             | The system map's reviews and task reports                                                                  | Yes                                                     |
| `space.json`                                | This folder is a space on this Mac                                                                         | **No**                                                  |
| `open/<device>.json`                        | When this Mac opened and quit the folder                                                                   | **No**                                                  |
| `system/last-read.json`                     | The system map as this Mac last read it                                                                    | **No**                                                  |

The per-Mac files are `DEVICE_ONLY` in `packages/core/src/anur-folder/layout.ts`, written into each `.anur/.gitignore`.

## What acts on what

- **Plugins, Git included,** act on the space. Their settings live in the space's own `.anur/plugins/`.
- **Git** syncs the space's own repo. It won't make a repo of a space that holds repos (each repo there syncs itself), nor sync a space that sits inside another repo; it says why in its status panel.
- **Threads and decisions** go to the nearest home above a doc, so a repo's go with the repo, whichever space it's opened in.
