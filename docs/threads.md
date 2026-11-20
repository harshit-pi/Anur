# Threads

How a person moves between threads, and what a thread does on its own. Read this before changing the thread panel (`renderer/src/regions/Think.tsx`), how a thread starts, or what a Build does. What a thread's agent may read is in `docs/thread-context.md`; this doc is what the person sees. A rule changes only with a dated entry and its why.

## Why threads

One long chat holding many directions pollutes: an idea rejected on one branch leaks into the next (the context eval's "never WhatsApp", `docs/decisions.md`). So a thread is one direction on one section, and it never sees another thread's chat.

```
a section
  ├─ thread: one direction ─── its chat, its options, its edits
  ├─ thread: another ───────── never sees the first one's chat
  └─ Build / Check ─────────── a thread too, started from an action
```

- A follow-up on the same direction stays in the thread: you reply in it.
- A new direction is a new thread, started on purpose. Anur never guesses which a message is, so it never moves a message into another thread.

## The rule: you stay where you are

Nothing but your own click on a thread moves you out of the thread you're in.

| What you do                                    | What happens                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Type in the thread                             | Replies in it                                                                  |
| Click another box on the map                   | Selects it; your thread stays open (30.37)                                     |
| Move the cursor to another section on the page | The same: your thread stays open                                               |
| ▶ Run on a proposed action                     | The Build runs beside you; the action's title opens it (30.36)                 |
| + in the thread's header                       | A new thread on the selected box: its threads, with the box to type in focused |
| ← in the thread's header                       | The selected box's threads                                                     |
| Click a choice, a thread label or a capsule    | Opens that thread: you asked for it                                            |

- No toast, banner or caption says where you are or what changed (`docs/ux.md`). The panel simply doesn't move.

## What a thread does on its own

| Rule                                                                  | Why                                                                    | Where                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| The agent is told each turn whether its edits land at once or wait    | In Auto it said "ready for you to use" over an edit already in the doc | `landingNote` in `main/threads/threads.ts` (30.38) |
| A turn's edits that landed read as one line per doc                   | Five "Used as it landed" lines for one answer read as noise            | `layout/landed-notes.ts` (30.38)                   |
| A Build or Check proposes no further actions                          | Each Build ended by planning more; three Builds left two new ones      | `proposeAction` (30.39)                            |
| A proposal matching work already planned, running or done isn't added | Builds side by side proposed each other's work                         | `main/threads/same-work.ts` (30.39)                |
| A page a thread makes goes beside the doc, never into attachments     | Attachments hold what people add; a Build put Metrics.md in one        | `main/threads/page-home.ts` (30.41)                |

- A thread is listed under every section it proposed work on, so a Build that proposed on another section showed there too. With 30.39 a Build proposes nothing, which closed that.
- Known gap: when a page is split into others, the old page stays until the person deletes it.

## How to check a change

- Live, in Anur Dev: open a thread, click three other boxes on the map and type on the page; the thread stays. Run a proposed action from the thread and from the map; you stay. Press + and type: a new thread on the box you selected.
- Replay a real session as a person would, recorded, before changing how threads start or move (see "Checking a change in the real app" in `docs/patterns.md`).

## History

- 2026-11-20 (30.38–30.41): the agent says how its edits landed; one landed line per turn; Builds plan no more work and duplicates aren't added; pages never go into attachments. All found in the same replay.
- 2026-11-20 (30.37): picking a box or moving the cursor no longer closes the open thread; + starts a new one on the selected box. Found replaying a GTM brainstorm: every box click swapped the panel and the thread you were in vanished.
- 2026-11-20 (30.36): ▶ Run no longer switches the panel to the Build it starts.
