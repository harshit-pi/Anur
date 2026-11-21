/**
 * What a thread on one node is given, and whether its agent uses it. Each
 * place context can come from holds one code word, and so does each place it
 * must not; the agent lists what it sees, then does a task that needs it all.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Scenario } from "./scenarios.ts";

const DOC = "Tally Plan.md";

const PLAN = `# Tally Plan

We launch Tally, a shared expense tracker for flatmates. Code word: JUNIPER.

## Audience

Flatmates aged 20–30 who split rent and bills. Code word: SAFFRON.

## Pricing

Free for up to 3 people in a flat; the paid tier is still open. Code word: MARIGOLD. Currency follows [[Money rules#Currency]].

## Risks

Splitwise is free and well known.
`;

const MONEY = `# Money rules

## Currency

All prices are in pounds (£). Code word: VERMILION.

## Refunds

Refunds within 14 days. Code word: INDIGO.
`;

const decision = (n: number, text: string, on: string) =>
  JSON.stringify({
    id: `eval-decision-${String(n)}`,
    at: "2026-11-20T00:00:00.000Z",
    seq: n,
    dev: "eval",
    kind: "decision",
    decision: text,
    quote: null,
    instead: null,
    until: null,
    who: "The team",
    scope: `section:${DOC}#${on}`,
    ref: null,
  });

const FOLDER = {
  open: DOC,
  files: {
    [DOC]: PLAN,
    "Money rules.md": MONEY,
    "Office.md": "# Office\n\nThe office plant is called Gerald. Code word: WALNUT.\n",
    ".anur/decisions/eval.jsonl": [
      decision(0, "Every price ends in .99. Code word: CINNABAR.", "Tally Plan › Pricing"),
      decision(1, "No lifetime deal, ever. Code word: AMBER.", ""),
      decision(2, "Write prices in US dollars. Code word: OBSIDIAN.", "Tally Plan › Risks"),
    ].join("\n"),
  },
};

/** Where each code word is, and whether a thread on Pricing should see it. */
const WORDS: { word: string; from: string; seen: boolean }[] = [
  { word: "MARIGOLD", from: "its own section", seen: true },
  { word: "JUNIPER", from: "the section above it", seen: true },
  { word: "SAFFRON", from: "a sibling section", seen: true },
  { word: "CINNABAR", from: "a decision on it", seen: true },
  { word: "AMBER", from: "a decision on the whole doc", seen: true },
  { word: "TANGERINE", from: "a file attached to the thread", seen: true },
  { word: "PERIWINKLE", from: "an input added to the section", seen: true },
  { word: "VERMILION", from: "the section it links to, in another doc", seen: true },
  { word: "OBSIDIAN", from: "a decision on another section", seen: false },
  { word: "INDIGO", from: "a section of the linked doc it doesn't link to", seen: false },
  { word: "WALNUT", from: "a doc nothing links to", seen: false },
  { word: "BLUEFIN", from: "another thread's chat", seen: false },
];

/** The attachment and the input, outside the folder, as a person's own files are. */
async function ownFiles(space: string): Promise<{ competitor: string; survey: string }> {
  const competitor = path.join(path.dirname(space), "competitor.txt");
  const survey = path.join(path.dirname(space), "survey.txt");
  await writeFile(competitor, "Splitwise Pro costs £2.99 a month. Code word: TANGERINE.\n");
  await writeFile(
    survey,
    "Flats said they'd pay at most £4 a month per flat. Code word: PERIWINKLE.\n",
  );
  return { competitor, survey };
}

/** Steps that read the folder or run anything, rather than Anur's own housekeeping. */
const peeked = (tools: string[]) => tools.filter((t) => !/anur|ToolSearch/i.test(t));

/** Anur's own tools are how a thread reads its inputs; the folder and the shell aren't. */
const ONLY_GIVEN =
  "Use only what Anur gave you for this thread and Anur's own tools (read its inputs with anur_read_input); don't open files in the folder or run commands.";

export const CONTEXT_SCENARIOS: Scenario[] = [
  {
    name: "context-given",
    about:
      "A thread on Pricing lists the code words it was given: what should reach it does, what shouldn't doesn't",
    folder: FOLDER,
    async run(s, check) {
      const { competitor, survey } = await ownFiles(s.space);
      const added = await s.addInputs("Pricing", [survey]);
      check(
        "input-added",
        JSON.stringify(added).includes('"added":1'),
        "The survey is added as Pricing's input",
        added,
      );
      await s.startWith(
        "Audience",
        "Remember the code word BLUEFIN for this thread. Reply with ok.",
      );
      const id = await s.startWith(
        "Pricing",
        `${ONLY_GIVEN} List every code word (the word in capitals after "Code word:") in what you were given for this thread, its inputs included. Reply with only the code words, comma-separated.`,
        [competitor],
      );
      const r = await s.replyOf(id);
      await s.shot("given");
      for (const w of WORDS)
        check(
          `${w.seen ? "sees" : "not"}-${w.word.toLowerCase()}`,
          r.text.includes(w.word) === w.seen,
          `${w.seen ? "Sees" : "Doesn't see"} ${w.from} (${w.word})`,
          r.text.slice(0, 400),
        );
      check(
        "no-peek",
        peeked(r.tools).length === 0,
        "It answered from what it was given, opening nothing",
        r.tools,
      );
    },
  },
  {
    name: "context-used",
    about:
      "A thread on Pricing writes a line that needs its decision, attachment, input and linked rule, and not another section's decision",
    folder: FOLDER,
    async run(s, check) {
      const { competitor, survey } = await ownFiles(s.space);
      await s.addInputs("Pricing", [survey]);
      const id = await s.startWith(
        "Pricing",
        `${ONLY_GIVEN} Pick our paid tier's price per flat per month from what you have, then write one line for the beta email giving it and how it compares with Splitwise Pro. Reply with just the line, then a last line PRICE: £x.xx with the price you picked.`,
        [competitor],
      );
      const { text, tools } = await s.replyOf(id);
      await s.shot("used");
      const prices = [...text.matchAll(/£\s?(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
      // The price it picked, from its own line: prose prices include differences ("£1 more").
      const picked = /PRICE:\s*£\s?(\d+(?:\.\d{1,2})?)/i.exec(text)?.[1];
      const ours = picked ? [Number(picked)] : [];
      check(
        "pounds",
        prices.length > 0,
        "Prices are in pounds, as the linked Money rules say",
        text,
      );
      check(
        "no-dollars",
        !/\$|USD|dollar/i.test(text),
        "Another section's decision (US dollars) isn't used",
        text,
      );
      check(
        "attachment",
        /2\.99/.test(text),
        "It compares with Splitwise Pro's £2.99, from the attached file",
        text,
      );
      check(
        "input",
        ours.length > 0 && ours.every((p) => p <= 4),
        "Our price stays within the £4 the survey input found",
        ours,
      );
      check(
        "decision",
        ours.length > 0 && ours.every((p) => Math.round(p * 100) % 100 === 99),
        "Our price ends in .99, as Pricing's decision says",
        ours,
      );
      const offers = /lifetime/i.test(
        text.replace(/\b(no|not|never|without|isn't|rather than)\b(\W+\w+){0,3}?\W+lifetime/gi, ""),
      );
      check("doc-decision", !offers, "No lifetime deal, as the whole doc's decision says", text);
      check(
        "no-peek",
        peeked(tools).length === 0,
        "It worked from what it was given, opening nothing",
        tools,
      );
    },
  },
];
