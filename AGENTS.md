# AGENTS.md

How people and agents work in this repo. Keep it short; it grows as the build does.

## Source of truth

- The design is in the AnurObsidian vault, `raw/Anur Brainstorming Product/Design/`. Read `- Index Design.md` first, then the page for the part you touch.
- Build in the order of `Design - Build Tasks.md`. A group is done only when its named tests pass in CI and someone who didn't build it has run its demo script.
- If code and design disagree, fix one of them in the same change; never leave them apart.

## Commands

- `pnpm install` once; Node is pinned in `.nvmrc`.
- `pnpm check` runs everything CI runs: typecheck, lint, format check and tests.
- `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm format` run one step each.
- `pnpm --filter @anur/desktop dev` runs the app with live reload; `build` then `start` runs the built app.
- `ANUR_SCREENSHOT=<file.png>` saves the first window and quits, in a throwaway profile; `ANUR_SCREENSHOT_PALETTE=1` opens the palette first, `ANUR_SCREENSHOT_DRAG=1` drags both dividers first (`=narrow` to their minimum), and `ANUR_THEME=light` or `dark` overrides the system theme, `ANUR_OPEN_FOLDER=<path>` opens a folder, `ANUR_CHECK_HOME=<path>` stands in for the home folder (to fake an iCloud path), and `ANUR_SCREENSHOT_CLICK="A,B"` clicks buttons by their text first.

## Git

- `main` takes changes only through pull requests with CI passing; a GitHub ruleset enforces it, and a pre-push hook stops a local push to `main` early.
- Work on a branch, such as `task/1.4-section-tree`, and open a PR; a person merges it.
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

## Brand

- Colours and type come from `brand/tokens.css`; don't add colours outside it.
