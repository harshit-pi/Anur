# Maps

What Anur's maps draw, what each mark means, and what they deliberately leave out. Read this before changing `MapView.tsx`, `SystemMap.tsx` or their layouts. A map change keeps to these rules, and a rule changes only with a dated entry here and its why.

## The rule

A map shows three kinds of thing, one shape and one meaning each (Mock 11).

```
Section   solid box            in the doc
Choice    dashed rounded card  not in the doc yet
Work      capsule in a lane    an action under its section
Thread    italic text on a line, or 💬 N on a box
```

- Dashes mean a choice, and only a choice: never an outside service, a link or a muted box.
- Colour carries state only on work (needs you, running, done, failed). A section is just its name.
- Anything else stays off the map, in the thread panel or the page. The map is read at a glance; every extra mark costs that.

## The doc map (`renderer/src/regions/MapView.tsx`; its boxes from `layout/map-boxes.ts`)

| Piece                     | What it is                                                                                                                       | Click                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Title and sections        | The doc's headings, as a mind map branching from the title                                                                       | Selects it; Think shows its threads                            |
| Choice card               | An option or proposed edit from a thread, not used yet; filled in once explored                                                  | Opens its thread at that card                                  |
| "N not picked"            | The options passed over once one was used, folded; opening it keeps the view still                                               | Opens or folds them                                            |
| Lane under a section      | The section's work: one capsule each for what's running, waiting or failed; planned and done fold into "▶ N planned", "✓ N done" | A capsule opens its thread at its card; Run, Stop, Approve act |
| Service mark on a capsule | Where the work acts (Gmail, Linear, GitHub), from its steps, or for planned work from its title                                  | —                                                              |
| Thread label              | Italic text on the line to a thread's choices; a choice's own name when a thread asks two                                        | Opens the thread                                               |
| 💬 N on a box             | Threads on that section with no choices or work                                                                                  | Opens the first                                                |
| → N on a box              | Links from that section to other docs                                                                                            | Lists them                                                     |
| A box from another doc    | A section another doc links to, drawn with its doc's name                                                                        | Opens that doc                                                 |

- Each choice hangs off the subsection of its name when the doc has one, else under a label of its name.
- A choice raised by a running action hangs under its own label, never loose round the section.
- Fit frames the sections and the choices waiting at the top level, never below 60% (`FIT_MIN`), centred on what it frames (30.27). Opening a map centres on the title at 75% or more (`READABLE`).
- The canvas carries Fit, Tidy and zoom (30.44). Legend, Sketch and Draw live in the doc's ⋯ menu while the map shows; the keys strip shows on a person's first map only, and a section's link count on hover only.
- A new box appears from Tab, Enter, double-clicking empty space, or dragging a box's handle onto empty space. Moving a box never changes the file.
- Nothing on the map covers anything else (`layout/map-room.ts`). When choices or work arrive on a section, the sections in their way slide apart just enough, with their own cards, in a short glide; the one that got them stays put. When cards go (a Use, a fold), nothing moves and the gap stays until Tidy.
- The map holds still under the pointer (30.40): while the pointer is on the map, nothing refits, zooms or pans it; when the layout shifts, as when an edit lands, the selected box keeps its place on screen and the map moves around it. With the pointer elsewhere, a map the person hasn't moved refits to show new boxes, as before.

## What the doc map leaves out

- **Links within the doc.** A `[[#Heading]]` in a section's text is not drawn as an arrow, and dragging a handle onto another box no longer writes one. Removed 2026-11-19: the arrows ran across the mind map, ended short of their boxes, and their labels ("section 1") said nothing. The link still works on the page; the map shows structure, choices and work.
- Another thread's chat, history or decisions. Decisions show as counts in the panel, not on the map.

## The system map (`renderer/src/regions/SystemMap.tsx`, `layout/system-map.ts`)

| Piece             | What it is                                                                     |
| ----------------- | ------------------------------------------------------------------------------ |
| Repo, group, part | Solid boxes from the code; a repo opens in place to its parts                  |
| Resource          | A table, queue or bucket a part uses, with its icon                            |
| Outside service   | Grey and solid, never dashed                                                   |
| Line              | Calls or links found in the code, labelled "N calls"; a guessed one is lighter |
| N decided         | Decisions on that box or line; amber when two disagree                         |

- By default the system map shows only what's true: the code and its decisions. Choices, threads and work belong to a task or project. They live in the panel, and a Work lens to show them on the map is designed (App 6, "Workflow" frames) but not built.
- The three kinds on the system map are on the branch `task/system-map-three-kinds`, not merged, pending that lens.

## How to check a change

- `pnpm check`, then package Anur Dev and open a real map: `anur-scenarios/churn-winback` has every kind of piece; `webhook-retries` has choices raised by an action.
- Click each kind of piece in the table above and check it does what its row says.
- A map change that adds a mark adds its row here, or it doesn't ship.

## History

- 2026-11-20: a part can be explored, as a choice can: Add · Explore this on its card, Skip as the × on hover. Narrower parts hang under it, and Add on one puts it under the part, which comes with it if new. Found by the app eval's `map-brainstorm`: brainstorm ideas come back as parts, which couldn't be explored.
- 2026-11-20: parts asked again, as a rethink, replace the earlier parts with the same name; parts with different names stay side by side. Found by the app eval's `map-brainstorm`: "None of these" left ten cards on the map.
- 2026-11-20: a box's handles are 8px and sit on the line a person sees: on a selected title box, its blue ring outside the border, not the border its fill hides. Checked by the app eval's `handles-on-line`.
- 2026-11-20: neighbours make room. Found by the app eval: a section kept in place had its choices drawn over the next section's choices.

- 2026-11-20 (30.44): a simpler canvas. Found comparing Anur with Living Map on the same brainstorm: the keys strip, legend, rarely used tools (Tidy stayed, as people reach for it) and a link count on every box read as noise.

- 2026-11-20 (30.40): the map holds still when edits land. Found replaying a brainstorm: an edit landed as the person clicked ▶ Run, the map re-laid out and zoomed from 89% to 76%, and the click hit empty space.

- 2026-11-19: links within a doc no longer drawn; Fit frames what matters at a readable zoom (30.27); dashes kept for choices only.
- 2026-11-19: three kinds on the doc map (Mock 11), choices you can switch or add beside (Anur PR 248).
