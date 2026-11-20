# Thread context

What a thread's agent sees, what it must never see, and how Anur holds that line. Read this before changing the bundle, the hook, the working copies or the MCP tools. A change here is checked against the rules below, and the rules change only with a dated entry and its why.

## The rule

A thread starts from its own context, never another thread's.

```
a thread's agent
  ├─ given (the bundle) ────── its section, the sections above it,
  │                            the rest of the doc, kept decisions
  │                            and findings, inputs, links
  ├─ may read and edit ─────── its own working copy of each doc,
  │                            the person's other files and code
  └─ never ─────────────────── .anur/ (every thread's chat and history)
                               another thread's working copy
                               another thread's chat, ever
```

- Why: a long chat pollutes, and an idea rejected in one section leaks into the next. The context eval caught a rejected option ("never WhatsApp") reaching a sibling's draft in a long chat, and never in Anur's threads (`docs/decisions.md`, "The context eval's first result").
- The agent otherwise runs at full power, as in a terminal. Only Anur's own data is off limits: `.anur/` and other threads' copies. Anur changes how an edit lands; it never refuses an edit to the person's own files.

## What a thread is given

- The bundle (`packages/core/src/context/bundle.ts`, `BUNDLE_RULES`): the own text of every section above, its own section in full, and the rest of the doc in full. Past `FULL_TEXT_BUDGET`, the rest falls back to an outline, with `anur_read_section` to fetch more.
- Kept decisions and findings carried nearest first, capped (see "What counts as a decision" in `docs/decisions.md`).
- Inputs the person added, and the sections the section links to.
- Never another thread's chat. Decided text is the doc, so it isn't pollution; discussion is.

## How it's held

The guard is a command hook plus deny rules in the session's settings (`packages/desktop/src/agent/hook.ts`, `hook-rules.ts`, `deny-rules.ts`). Each check names the message the agent gets, so it knows what to do instead.

| What the agent tries                                                                        | What happens                                                                  | Message        |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------- |
| A file tool on a doc in the folder                                                          | Sent to its working copy, made from the doc                                   | `toCopy`       |
| A file tool, the shell or an MCP argument naming `.anur/`                                   | Refused; `du`, `ls` and `stat` may size or list it                            | `anur`         |
| A recursive read from a root holding `.anur/` (`grep -r`, `rg -u`, `find … -exec cat`)      | Refused unless it excludes `.anur`                                            | `recursive`    |
| `git clean -x`                                                                              | Refused unless it keeps `.anur` (`-e .anur`)                                  | `gitClean`     |
| A file tool on another thread's working copy                                                | Refused                                                                       | `otherCopy`    |
| The shell naming another thread's copy (`cat`, `grep`, any command but `du`, `ls`, `stat`)  | Refused (30.14)                                                               | `otherCopy`    |
| A search from the copies folder or above it (`rg … ~`, `grep -r … /`, `find / … -exec cat`) | Refused (30.14)                                                               | `searchCopies` |
| An MCP tool's argument naming another thread's copy                                         | Refused (30.14)                                                               | `otherCopy`    |
| Its own working copy, where the person's deny rules forbid the doc                          | Refused, as for the doc                                                       | `ownRule`      |
| The shell removing a doc (`rm`, `unlink`, `trash`)                                          | Refused: use `anur_remove_doc`, which moves it to the Trash with Undo (30.43) | `removeDoc`    |
| A shell write onto a doc                                                                    | Allowed; Anur adopts it as the thread's proposal                              | —              |

- Paths are read as the shell sees them: `~`, `$HOME` and `${HOME}` are the home folder, and `Application\ Support` is one name. Matching ignores letter case, as macOS does.
- Working copies live outside the folder, in app support at `agent/copies/<thread>/`. Every thread gets its own.
- The thread check runs before and during every turn: sample calls in a throwaway folder, a start hook that checks in, and every tool call the agent reports done must be in the hook's log. A miss stops the turn.

## Known gaps

The hook reads commands as text, so a determined agent can reach around it. Each gap is a row to close, not a reason to stop.

- A path built at run time: a shell variable other than `HOME` (`D=~/Library; cat $D/…`), a glob that expands into the copies folder, or a path assembled inside a script.
- Another language's file reads (`python -c "open(…)"`, `node -e`), which the hook doesn't parse.
- Plain `find` without `-exec` or `xargs` lists other copies' file names; it reads no content.

## How to check a change

- `packages/desktop/src/agent/hook-rules.test.ts`: every row of the table above has a test. A new rule adds one, and a refused case and an allowed case both.
- Live, in Anur Dev: start a thread and ask it to run `cat "$HOME/Library/Application Support/Anur Dev/agent/copies/<another thread>/<doc>.md"`. It must answer that the read was refused. The hook's log, `agent/hooks/<thread>.log.jsonl` in app support, shows the call with `refused` set.
- A step the UI labels "Read Home.md" may be a shell `cat`: check the log's `tool`, not the label.

## History

- 2026-11-19 (30.14): the shell and MCP arguments can no longer read another thread's working copy. Found when a run's agent searched the app's support folder with `find`; live-tested with `cat "$HOME/…"`, refused.
- Group 3: the hook, `.anur/` off limits, docs redirected to working copies, other copies refused to file tools.
