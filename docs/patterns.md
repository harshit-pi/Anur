# Patterns

How things are done in this codebase. Follow these unless a change says why not; when a pattern changes, change it here in the same PR.

## A new IPC channel

1. Add it to `ipcContract` in `packages/desktop/src/shared/ipc-contract.ts`, with a zod schema for the request (`.strict()`, bounded strings) and the response.
2. Add its handler to the `handlers` table in `src/main/index.ts`; the table is typed against the contract, so a missing handler fails the typecheck. Use the window's own folder, `folders.current(webContentsId)`, and refuse a doc path that isn't in `folder.docs`.
3. Call it from the page with `anur.call("name", request)`.
4. Something main pushes is an event: add it to `ipcEvents`, send it with `send(win, "name", payload)`, and listen with `anur.on("name", fn)`, which returns its own unsubscribe.

Branded core types (IDs) arrive unbranded over IPC: parse them back with the core schema, such as `PreviewPart.array().parse(parts)`, rather than casting.

## Changing the doc from code

- Every transaction that changes the doc must carry a `userEvent` from the allowed kinds in `src/renderer/src/editor/editor-filter.ts`: `input…`, `delete…`, `undo`, `redo`, `move…`, `outside`, `apply…`, `restore…`. Anything else is dropped, on purpose.
- Pick a tag that says what happened: `input.resize`, `input.image`, `apply`, `apply.undo`, `input.restore`.
- `input.paste` and `input.drop` go through the paste guard, which reshapes multi-line text. Text Anur writes itself, such as an image embed, takes its own `input.…` tag instead.
- A change made outside Anur is tagged `outside` and kept off the undo stack (`Transaction.addToHistory.of(false)`), so ⌘Z never undoes someone else's change.

## Widgets on the page

- Block widgets, and decorations that replace whole lines, must come from editor state (`EditorView.decorations.compute`, or a `StateField`), never from a `ViewPlugin`.
- A widget that needs the disk asks main. Import the bridge dynamically inside the widget (`import("../../bridge.ts")`), so the module still loads in tests.
- The page's own path is the `pagePath` facet.
- Find a section by its heading path, with a tree built from the page's text and the doc's **real** file name. A doc with text before its first heading names its title section after the file.
- Return `true` from `ignoreEvent` and handle the widget's own mouse events, calling `preventDefault` on `mousedown` so the editor doesn't move the cursor under it.

## The agent layer

```
renderer  Think.tsx ──IPC──▶ main  threads/threads.ts   one per folder
                                   threads/hub.ts       routes host messages
                                        │ postMessage
                                   agent/host.ts         utilityProcess, ACP client
                                        │ ACP (stdio)
                                   ACP adapter ─▶ claude  the person's own install
                                        │ runs, per tool call
                                   out/main/hook.js      agent/hook-rules.ts decides
                                        │ starts, per session
                                   out/main/mcp-server.js ──socket──▶ main threads/anur-socket.ts
```

- The host, hook, MCP server and Claude Code's ACP adapter are each their own build entry in `electron.vite.config.ts`, so `out/main` (and the packaged app) carries them. They run with Electron as Node (`ELECTRON_RUN_AS_NODE=1`).
- The hook's decisions are pure (`hook-rules.ts`, `deny-rules.ts`) and tested without an agent. `hook.ts` only reads stdin, logs and answers.
- Thread lines, previews and history use core's formats and `JsonlWriter`. One writer per file per process; a second `open` of the same file throws.
- ACP methods that are only in the SDK's unstable table (such as `auth/status`) are called by name.

## Checking a change in the real app

Unit tests aren't enough for anything on screen or anything an agent does. Run the built app in check mode; it quits by itself:

```bash
cd packages/desktop && pnpm build
ANUR_SCREENSHOT=/tmp/shot.png ANUR_OPEN_FOLDER=/path/to/folder ANUR_SCREENSHOT_CLICK="Plan" \
  ANUR_SCREENSHOT_PROBE='new Promise((d) => setTimeout(() => d(document.title), 1000))' \
  pnpm exec electron . | grep '^probe'
```

| Switch                                              | Does                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ANUR_SCREENSHOT=<png>`                             | Check mode: a throwaway profile, the first window saved as a screenshot, then quit       |
| `ANUR_OPEN_FOLDER=<path>`                           | Opens that folder                                                                        |
| `ANUR_SCREENSHOT_CLICK="A,B"`                       | Clicks buttons by their text or aria-label, in order                                     |
| `ANUR_SCREENSHOT_PROBE=<js>`                        | Evaluates an expression (it may return a promise) in the page and prints `probe: <json>` |
| `ANUR_SCREENSHOT_TYPE`, `_LINE`, `_KEYS`            | Types into the page at a line, then presses keys                                         |
| `ANUR_SCREENSHOT_MENU=<id>`                         | Clicks a menu-bar item by its id                                                         |
| `ANUR_SCREENSHOT_COPY=1`                            | Copies the page's selection                                                              |
| `ANUR_SCREENSHOT_PALETTE=1`, `_DRAG=1` or `=narrow` | Opens the palette, or drags the dividers                                                 |
| `ANUR_CHECK_PROFILE=<dir>`                          | Shares one profile across runs, to test what is remembered, such as resuming a thread    |
| `ANUR_CHECK_HOME=<dir>`                             | Stands in for the home folder, to fake an iCloud path                                    |
| `ANUR_THEME=light` or `dark`                        | Overrides the system theme                                                               |
| `ANUR_CLAUDE=<path>`                                | Uses that `claude` instead of the one on the login shell's PATH                          |
| `CLAUDE_CONFIG_DIR=<empty dir>`                     | Makes Claude Code look signed out, to see the sign-in view                               |

- In a probe, `window.anurView` is the page's `EditorView` and `window.anur` is the bridge.
- A probe that sends a thread a message spends real tokens on the person's account: keep the prompt tiny ("Reply with OK only").
- Run checks on a copy of a real folder, never on the person's own, and never click a sign-in, which opens their browser.

## Tests

- `core` is pure and tested directly; most logic belongs there.
- The thread service is tested with a fake hub that records what would go to the agent and plays the agent's replies (`main/threads/threads.test.ts`).
- Programs the agent runs (the hook, the MCP server) are tested by spawning them as they run: Node runs the `.ts` file directly.
- The main loop is tested end to end without the window (`main/threads/end-to-end.test.ts`): the real agent host, hook and thread service, with `agent/testing/fake-agent.ts` standing in for Claude Code. The fake speaks ACP and runs the session's hooks as Claude Code does, so the thread check, working copies and previews all run for real in CI.
- The context eval runs on demand, never in CI, since it spends the person's tokens: `pnpm eval:context [runs] [modes]`, modes from `one-chat`, `outline`, `full` and `fetch`. Results land in `evals/context/results/`.
- Code the eval imports runs under Node's own TypeScript support, which can't strip constructor parameter properties: write such classes with plain fields.
- For hand-written algorithms, add a test over many random inputs (see the diff test in `core/src/text/diff.test.ts`).

## Gotchas found the hard way

- macOS's temp folder is a symlink (`/var` → `/private/var`). The hook resolves real paths, so anything compared with what it sees must be real too (`realpathSync`).
- A Unix socket path must stay under about 104 bytes. Anur's lives in a fresh folder in the system temp folder, not in app support.
- Claude Code's own permission check runs before the hook. A call a deny rule stops never reaches the hook, so the hook log isn't a list of every attempt.
- A session's working copies are one of its working folders, so Claude Code applies the person's relative deny rules there too.
- `open Anur.app` on an app that is already running only brings the old copy forward: quit it first to get a new build.
- `pnpm package` packs only `out/**`. Anything the app runs must be a build entry, not a dependency.
- A hover must never change the size of anything above or beside a button: the button moves from under the pointer and the click misses. A choice card's text opened on hover and pushed Use, Add as subsection and Explore this down, so people clicked twice (30.30). Open things on a click, or reserve the room.
- A block widget (an image, a table) must put its vertical space in `padding`, never `margin`: CodeMirror's height map misses the margin below it, so every widget above a line shifts where the editor thinks that line is, and Up and Down land several lines away. A `figure` also carries a browser margin of its own, so set `margin: 0px` (style-mod drops a bare `0`).

## Git and PRs

- Never commit to `main`. Work on a branch such as `task/3.12-mcp`, open a PR, and turn on auto-merge (`gh pr merge --auto --squash`); it merges once CI passes.
- Never force-push. If a branch falls behind after another PR squash-merges, merge `origin/main` into it.
- Every PR description has a "## Release note" section: one line for people using Anur, as the app's What's new shows it, or "none". The release script gathers these into the GitHub release, the update feed and What's new, and lists PRs that have none.
- The pre-commit hook formats, lints and type-checks; `pnpm check` runs what CI runs.
- This repo is public: no personal names, emails or private notes in code, comments, docs or PR text.
- `docs/what-anur-reads.md` lists every technology the engineering plugin reads, with Read, Partly or Not yet. A PR that adds, changes or removes a detector, build file, route or call pattern updates it in the same PR, so a miss can be told apart as a bug or a new technology.
