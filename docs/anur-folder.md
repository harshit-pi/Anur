# Vaults, homes and `.anur/`

Three different things share one folder name. Mixing them up is how a parent folder once became a git repo over its own child repos, so read this before changing how folders open, what's committed, or what a plugin acts on.

## The three

| Thing        | What marks it                                                                | What it is                                                                                                                                    | Committed                                   |
| ------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Vault**    | `.anur/vault.json` at its root                                               | The folder a window works in. It gathers every `.anur/` inside it, its repos' too. Its plugins and Git act on it alone. One per window.       | **Never.** Each Mac chooses its own vaults. |
| **Home**     | A folder inside a vault with `.anur/` or `.git`; the vault's root is one too | Where a doc's threads, decisions, section IDs and history are kept: the nearest home above the doc (18.15). A repo's home goes with the repo. | Yes, with its repo                          |
| **`.anur/`** | The folder itself                                                            | What Anur keeps beside a home's docs: the files listed below.                                                                                 | Yes, but the per-Mac files below            |

**Having a `.anur/` doesn't make a folder a vault.** Every repo has one, for its decisions, and a repo can be a vault on one Mac and a part of `~/workspace` on another. Only `vault.json` says "vault". Code must never treat "has `.anur/`" as "is a vault".

`vault.json` stays on each Mac because the same repo is shared: committed, a teammate who cloned it into their own `~/workspace` vault would get a vault inside a vault. A test fails if it's ever committed (`vaults.test.ts`).

## Opening a folder

- **It's inside a vault**, or is one: that vault opens, and the page says once "Launch is part of the anur-product vault, opened there". Nothing is ever a smaller vault inside a bigger one.
- **Anything else** becomes a vault (`vault.json` written). A vault inside it stops being one, with no question asked: only its marker goes. Its `.anur/` stays as it is: its threads and decisions are read by the new vault as part of it, its plugin settings sit unused while it's part of the bigger vault, and opening it on its own again makes it a vault again with everything it had.
- **No vault sits inside another.**

The engineering workspace (`~/workspace`, many repos) is one vault; its code repos are homes and parts on its system map, not vaults.

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
| `vault.json`                                | This folder is a vault on this Mac                                                                         | **No**                                                  |
| `open/<device>.json`                        | When this Mac opened and quit the folder                                                                   | **No**                                                  |
| `system/last-read.json`                     | The system map as this Mac last read it                                                                    | **No**                                                  |

The per-Mac files are `DEVICE_ONLY` in `packages/core/src/anur-folder/layout.ts`, written into each `.anur/.gitignore`.

## What acts on what

- **Plugins, Git included,** act on the vault. Their settings live in the vault's own `.anur/plugins/`.
- **Git** syncs the vault's own repo. It won't make a repo of a vault that holds repos (each repo there syncs itself), nor sync a vault that sits inside another repo; it says why in its status panel.
- **Threads and decisions** go to the nearest home above a doc, so a repo's go with the repo, whichever vault it's opened in.
