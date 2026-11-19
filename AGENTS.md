# AGENTS.md

How people and agents work in this repo. Keep it short; it grows as the build does.

## Read first

- [`docs/decisions.md`](docs/decisions.md): the engineering decisions made so far, each with why.
- [`docs/patterns.md`](docs/patterns.md): how things are done here: IPC channels, changing the doc, widgets, the agent layer, checking a change in the real app, tests, and gotchas.
- [`docs/thread-context.md`](docs/thread-context.md): what a thread's agent sees and must never see (`.anur/`, other threads' working copies), and how the hook holds it; read it before changing the bundle, the hook, working copies or MCP tools.
- [`docs/anur-folder.md`](docs/anur-folder.md): spaces, homes and `.anur/`, which are three different things; what each file in `.anur/` is and whether it's committed. Read it before changing how folders open, what's committed, or what a plugin acts on. A `.anur/` never by itself means a space.
- [`docs/maps.md`](docs/maps.md): what the doc map and the system map draw, what each mark means, and what they leave out; read it before changing either map.
- [`docs/what-anur-reads.md`](docs/what-anur-reads.md): every language, framework and file the engineering plugin reads, and what it doesn't yet; check it before calling a miss a bug.
- Before changing what gets kept as a decision, read "What counts as a decision" in `docs/decisions.md`: a decision is what a person said should hold, or their correction of the agent; never a pick (the page holds it) or the agent's own assumption.
- A PR that makes a decision or a pattern, or changes one, updates these files in the same PR.

## Source of truth

- The design is in the AnurObsidian vault, `raw/Anur Brainstorming Product/Design/`. Read `- Index Design.md` first, then the page for the part you touch.
- Build in the order of `Design - Build Tasks.md`. A group is done only when its named tests pass in CI and someone who didn't build it has run its demo script.
- If code and design disagree, fix one of them in the same change; never leave them apart.

## Commands

- `pnpm install` once; Node is pinned in `.nvmrc`.
- `pnpm check` runs everything CI runs: typecheck, lint, format check and tests.
- `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm format` run one step each.
- `pnpm --filter @anur/desktop dev` runs the app with live reload; `build` then `start` runs the built app.
- `pnpm --filter @anur/desktop package` builds an unsigned `Anur.app` in `packages/desktop/dist/mac-arm64/`; signing and notarising come with group 13.
- `ANUR_SCREENSHOT=<file.png>` saves the first window and quits, in a throwaway profile; `ANUR_SCREENSHOT_PALETTE=1` opens the palette first, `ANUR_SCREENSHOT_DRAG=1` drags both dividers first (`=narrow` to their minimum), and `ANUR_THEME=light` or `dark` overrides the system theme, `ANUR_OPEN_FOLDER=<path>` opens a folder, `ANUR_CHECK_HOME=<path>` stands in for the home folder (to fake an iCloud path), and `ANUR_SCREENSHOT_CLICK="A,B"` clicks buttons by their text first.

## Git

- `main` takes changes only through pull requests with CI passing; a GitHub ruleset enforces it, and a pre-push hook stops a local push to `main` early.
- Work on a branch, such as `task/1.4-section-tree`, open a PR, and turn on auto-merge (`gh pr merge --auto --squash`): it squash-merges once CI passes. Never force-push.
- The pre-commit hook fixes and checks staged files with ESLint and Prettier, then type-checks the whole workspace.

## Layout

- `packages/core`: sections, IDs, bundles, context and previews. No Electron, no React, no file system; ESLint and its `tsconfig` both reject them.
- `packages/desktop`: the Electron app and everything that touches the disk or the agent.
  - `src/main`: the thin main process; every IPC request is checked against `src/shared/ipc-contract.ts` and its sender.
  - `src/preload`: `window.anur.call`, the page's only way out.
  - `src/renderer`: sandboxed, no Node or Electron; ESLint rejects those imports here.
- A new package is split out only when something else consumes it.

## Rules the design fixes

- Markdown files are the truth. `.anur/` only adds to them; deleting it never loses a doc.
- `core` has no Electron, no React and no file system access.
- While a doc is open, only its editor writes the file. Agents propose; a person applies.
- Every line Anur writes in `.anur/` has its own ID, and every file that changes often has one writer.
- A thread runs the person's own agent at full power. Anur blocks only where other threads live, and redirects doc edits to a working copy.

## Plugins

- A change to a plugin under `plugins/` bumps its `version` in `plugins/<id>/manifest.json`. `pnpm plugins:check` fails without the bump: the site keeps each version's file for good, so new code under an old version would be refused on people's Macs.
- `pnpm release` publishes plugins too, only those newer than the live feed. Publishing a plugin alone, between releases, is `pnpm plugins:publish`, from main.

## Experience

- Never make the experience worse than what people already use: a doc editor like Google Docs or Quip, or an agent like Claude Code. Anur works behind the scenes; the page reads and types as people expect.
- Not supporting something yet is fine. Removing or blocking something those tools already let people do is not.
- Get the core working and strong before adding features. Prefer fixing what exists to adding a new button, mark or panel.
- It should feel intuitive at first use. Mock a screen before building it, and drop anything a person would have to learn.
- No words explaining what people already know from those tools: no caption on a queued message, no banner saying what just happened, no mark saying a thing is done. If Claude Code or Google Docs shows it without words, so does Anur. Check every mock for such text before showing it.

## Brand

- Colours and type come from `brand/tokens.css`; don't add colours outside it.
