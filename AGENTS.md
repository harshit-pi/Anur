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

## Git

- `main` takes changes only through pull requests with CI passing; a GitHub ruleset enforces it, and a pre-push hook stops a local push to `main` early.
- Work on a branch, such as `task/1.4-section-tree`, and open a PR; a person merges it.
- The pre-commit hook fixes and checks staged files with ESLint and Prettier, then type-checks the whole workspace.

## Layout

- `packages/core`: sections, IDs, bundles, context and previews. No Electron, no React, no file system; ESLint and its `tsconfig` both reject them.
- `packages/desktop`: the Electron app and everything that touches the disk or the agent.
- A new package is split out only when something else consumes it.

## Rules the design fixes

- Markdown files are the truth. `.anur/` only adds to them; deleting it never loses a doc.
- `core` has no Electron, no React and no file system access.
- While a doc is open, only its editor writes the file. Agents propose; a person applies.
- Every line Anur writes in `.anur/` has its own ID, and every file that changes often has one writer.
- A thread runs the person's own agent at full power. Anur blocks only where other threads live, and redirects doc edits to a working copy.

## Brand

- Colours and type come from `brand/tokens.css`; don't add colours outside it.
