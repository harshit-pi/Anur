# Corpora

Real edits that gate changes to the parser and the section ID matcher (task 1.14 of the build tasks).

## `sections/`

80 cases, each one Markdown file at two commits of the AnurObsidian vault, before and after an edit that changed its headings.

- **Scrambled.** Every word is a random token, the same token for the same word throughout a case, and digits are swapped by one random permutation. Heading structure and word overlap are real; nothing readable is published. The builder checks that each scrambled pair draws the same section trees and gives the same similarity scores as the original.
- **Labelled from the line diff, not the matcher.** A kept heading line is the same section; a heading removed and the same text added elsewhere is a move; a changed block with one removed and one added heading is a rename; anything else is a new or deleted section.
- **Reviewed where they disagreed.** The 13 cases where the diff's labels and the matcher disagreed were read and judged by hand; the verdicts are in `sections-reviewed.json`, keyed by a hash of commit and file. In every case the matcher was right or a defensible call; four were close, and are marked.
- **Golden trees** in `sections/golden/` fix the section tree each file draws.

## What the test asks

`packages/desktop/src/corpus/section-corpus.test.ts`:

- no wrong match in any case: a new section is never given another section's ID;
- the same file always draws the same sections;
- more than 90% of sections that stayed the same keep their ID.

On 2026-11-17: 673 of 676 kept their ID (99.6%), none wrong, all 127 new sections got new IDs, and all 25 orphans had a suggestion.

## Rebuilding

```bash
node scripts/corpus/build-section-corpus.ts <clone of the vault> 80
```

Scrambling is random, so a rebuild changes every token; delete `sections/golden/` and run the test once to write new golden trees. `CORPUS_PLAIN_DIR` writes readable copies for checking labels; never commit them.
