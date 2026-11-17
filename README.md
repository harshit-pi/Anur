# Anur

A local app for writing long docs with AI. The page is a plain Markdown file; each section has its own threads, run by the coding agent you already use, and a thread's work comes back as a preview you apply.

## Status

Work follows the build tasks, group by group:

| Group | What                              | Status                      |
| ----- | --------------------------------- | --------------------------- |
| 0     | Spike: drive Claude Code over ACP | Done; all seven claims held |
| 1     | Skeleton and schema               | 1.1 and 1.2 done            |
| 2     | One page                          |                             |
| 3     | One thread, one section           |                             |
| 4     | Context per section               |                             |

## Where the design lives

The PRD, the mocks and the low-level design are in the AnurObsidian vault, under `raw/Anur Brainstorming Product/`:

- `PRD v0 - Anur Brainstorming Product.md`
- `Design/- Index Design.md`, then the pages it lists
- `Design/Design - Build Tasks.md` for the order of work
- `Design/Design - Spike Results.md` for what group 0 proved

## Repo

- `packages/core` and `packages/desktop`: the two packages; `pnpm check` runs what CI runs.
- `brand/`: the app icon, the mark, and light and dark colour and type tokens.
- Node is pinned in `.nvmrc`.
- How to work in this repo, for people and agents: `AGENTS.md`.
