/**
 * The agent as a partner on the map, not a doc writer: open questions come
 * back as choices to explore, work to do as actions to run, and the page
 * changes only when something is used or done, briefly, as the record.
 * Asks are worded as a person would, never naming Anur's tools.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Session } from "./app.ts";
import type { Check, Scenario } from "./scenarios.ts";

const DOC = "Launch Plan.md";

const PLAN = `# Launch Plan

We launch Tally, a shared expense tracker for flatmates, to our 400-person beta list in March.

## Growth

We need more beta signups before March.

## Audience

Flatmates aged 20–30 who split rent and bills.

## Pricing

Free for up to 3 people in a flat. The paid tier is still open.

## Launch steps

- Write the FAQ
- Email the beta list

## Risks

Checked against [[Market notes]].

- Splitwise is free and well known.
- Splitwise has 50 million monthly users.
- Bank linking may slip past March.
`;

const NOTES = `# Market notes

- Splitwise has about 3 million monthly users (its 2025 filing).
- Splitwise's basic plan is free; Splitwise Pro costs £2.99 a month.
`;

const COMPETITORS = `name,price_gbp,per,notes
Splitwise Pro,2.99,person/month,free tier with limits
Tricount,0,person/month,free with ads
Settle Up,1.49,person/month,premium removes ads
Flatfair,4.50,flat/month,deposits and bills
Kittysplit,0,group,one-off events only
`;

const FOLDER = { open: DOC, files: { [DOC]: PLAN, "Market notes.md": NOTES } };

type Set = {
  thread: string;
  options: { id: string; title: string; text: string; why?: string }[];
  heading: string | null;
  within: string | null;
  used: string | null;
  several?: boolean;
};

const section = (doc: string, name: string) =>
  doc.split(`## ${name}`)[1]?.split(/\n## /)[0]?.trim() ?? "";
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** Every option set offered so far, as the app sees it, oldest first, with its thread. */
async function sets(s: Session): Promise<Set[]> {
  // When each was offered, by its first option, from the stored lines.
  const at = new Map<string, string>();
  for (const l of await s.lines("docs"))
    if (l.kind === "options")
      for (const o of (l.options as { id: string }[] | undefined) ?? []) at.set(o.id, String(l.at));
  const out: (Set & { at: string })[] = [];
  for (const t of await s.threads())
    for (const i of t.items as unknown as (Set & { kind: string })[])
      if (i.kind === "options")
        out.push({ ...i, thread: t.id, at: at.get(i.options[0]?.id ?? "") ?? "" });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** The latest agent reply in the thread Think shows. */
async function lastReply(s: Session): Promise<string> {
  const said = (await s.lines("docs"))
    .filter((l) => l.kind === "message" && l.role === "agent")
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .at(-1)?.text;
  return typeof said === "string" ? said : "";
}

/** The map's cards, as their titles. */
const cards = (s: Session) =>
  s.win.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".map-option:not(.map-fold)")].map(
      (o) => o.innerText.split("\n")[0]?.trim() ?? "",
    ),
  );

/** Nothing on the page changed. */
const pageSame = async (s: Session, check: Check, id: string, before: string) => {
  check(id, (await s.file()) === before, "The page doesn't change while nothing is used");
};

/** Tools that reach a service outside the folder: another MCP server's, by name. */
const outside = (tools: string[]) => tools.filter((t) => /^mcp__(?!anur__)/i.test(t));

const PAID =
  /\b(paid ads?|ad spend|ads? budget|facebook ads?|google ads?|instagram ads?|sponsored|promoted posts?|boosted)\b/i;
const kept = (t: string) =>
  t.replace(/\b(no|not|without|never|zero|instead of)\b(\W+\w+){0,3}?\W+(paid|ads?)\b/gi, "");

export const MAP_SCENARIOS: Scenario[] = [
  {
    name: "map-brainstorm",
    known: {
      "explore-1":
        "Brainstorm ideas come back as parts (Add/Skip), which have no Explore (found 2026-11-20)",
      "explore-2": "As explore-1: parts have no Explore (found 2026-11-20)",
      "use-writes": "As explore-1: parts have Add, not Use (found 2026-11-20)",
    },
    about:
      "An open question becomes choices on the map; a constraint sticks; a rethink replaces the set; two levels of explore; Use writes briefly",
    folder: FOLDER,
    async run(s, check) {
      const start = await s.file();
      await s.select("Growth");
      await s.ask("We need more beta signups before March. What could we do?");
      await s.shot("first-set");
      const first = (await sets(s)).at(-1);
      check(
        "choices",
        !!first && first.options.length >= 3,
        "An open question comes back as 3 or more choices on the map",
        first?.options.map((o) => o.title),
      );
      check(
        "choices-why",
        !!first && first.options.every((o) => (o.why ?? o.text).trim().length > 20),
        "Each choice says why",
      );
      const said = await lastReply(s);
      const relisted = (first?.options ?? []).filter((o) => said.includes(o.title));
      check(
        "short-reply",
        relisted.length < (first?.options.length ?? 0),
        "The reply points at the cards rather than restating every one",
        { words: words(said), relisted: relisted.map((o) => o.title) },
      );
      await pageSame(s, check, "page-same", start);

      // A constraint said mid-brainstorm.
      await s.ask("No paid ads, we have no budget for them.");
      const decisions = (await s.lines("decisions")).filter((l) => l.kind === "decision");
      check(
        "constraint-kept",
        decisions.some((d) => typeof d.quote === "string" && /paid ads/i.test(d.quote)),
        "The constraint is saved as a decision in the person's words",
        decisions.map((d) => d.quote),
      );

      // A rethink.
      const before = (await sets(s)).flatMap((x) => x.options.map((o) => o.title.toLowerCase()));
      await s.ask("None of these. Think differently.");
      await s.shot("rethink");
      const fresh = (await sets(s)).at(-1);
      const freshTitles = fresh?.options.map((o) => o.title) ?? [];
      check(
        "rethink-new",
        freshTitles.length >= 2 && freshTitles.every((t) => !before.includes(t.toLowerCase())),
        "A rethink brings a fresh set, none repeating the old ones",
        freshTitles,
      );
      // Only the set the rethink answers: another question asked beside it stays.
      const same = (x: Set) =>
        !!fresh &&
        !!x.several === !!fresh.several &&
        x.heading === fresh.heading &&
        x.options[0]?.id !== fresh.options[0]?.id;
      const replaced = (await sets(s))
        .filter(same)
        .flatMap((x) => x.options.map((o) => o.title.toLowerCase()));
      const onMap = await cards(s);
      check(
        "rethink-replaces",
        replaced.every((t) => !onMap.some((c) => c.toLowerCase() === t)),
        "The fresh set replaces the old cards on the map",
        { replaced, onMap },
      );
      check(
        "constraint-followed",
        !(fresh?.options ?? []).some((o) => PAID.test(kept(`${o.title} ${o.text} ${o.why ?? ""}`))),
        "No choice after it uses paid ads",
        fresh?.options.map((o) => o.title),
      );
      // A constraint may go in the page as a decision; the ideas mustn't.
      const settled = await s.file();
      const pageNow = settled.toLowerCase();
      const titles = (await sets(s)).flatMap((x) => x.options.map((o) => o.title.toLowerCase()));
      check(
        "page-no-ideas",
        titles.every((t) => !pageNow.includes(t)),
        "No idea is written into the page while nothing is used",
        titles.filter((t) => pageNow.includes(t)),
      );

      // Two levels of explore, then Use from the deepest.
      await s.click("aside.right-sidebar .think-offer button", /^Explore this$/, 0);
      await s.idle();
      const level1 = (await sets(s)).at(-1);
      check(
        "explore-1",
        !!level1?.within && level1.options.length >= 2,
        "Explore brings narrower choices under the card",
        level1?.options.map((o) => o.title),
      );
      await s.click("aside.right-sidebar .think-offer button", /^Explore this$/, 0);
      await s.idle();
      const level2 = (await sets(s)).at(-1);
      check(
        "explore-2",
        !!level2?.within && level2.within !== level1?.within && level2.options.length >= 2,
        "Exploring a narrower choice goes a level deeper",
        level2?.options.map((o) => o.title),
      );
      await pageSame(s, check, "page-same-3", settled);
      const beforeUse = await s.file();
      await s.click("aside.right-sidebar .think-offer button", /^Use$/, 0);
      await s.win.waitForTimeout(3000);
      await s.shot("used");
      const now = await s.file();
      const grew = section(now, "Growth").length - section(beforeUse, "Growth").length;
      check("use-writes", grew > 0, "Use writes the pick into Growth");
      check("use-brief", grew <= 600, "…briefly: the page is the record, not the brainstorm", grew);
      check(
        "others-untouched",
        ["Audience", "Pricing", "Launch steps", "Risks"].every(
          (n) => section(now, n) === section(start, n),
        ),
        "Nothing else on the page changes",
      );
    },
  },
  {
    name: "map-two-asks",
    about: "Two questions in one ask come back as two named choices on the map",
    folder: FOLDER,
    async run(s, check) {
      const start = await s.file();
      await s.select("Audience");
      await s.ask("Who do we target first, and what do we offer them?");
      await s.shot("two-asks");
      const named = (await sets(s)).filter((x) => x.heading);
      const headings = [...new Set(named.map((x) => x.heading?.toLowerCase()))];
      check("two-named", headings.length >= 2, "Two choices, each under its own name", headings);
      check(
        "two-each",
        named.length >= 2 && named.every((x) => x.options.length >= 2),
        "Each has its own options",
        named.map((x) => x.options.length),
      );
      await pageSame(s, check, "page-same", start);
    },
  },
  {
    name: "actions-chain",
    about:
      "Two actions where the second needs the first: it waits, then links to what the first actually made",
    folder: FOLDER,
    async run(s, check) {
      const start = await s.file();
      await s.select("Launch steps");
      await s.ask(
        "Let's get these done: the FAQ first, then a beta email that points people to the FAQ. Keep both as notes in this folder, not in Gmail or any other service. Set them up to run, don't do them yet.",
      );
      await s.shot("planned");
      const planned = (await s.lines("docs")).filter((l) => l.kind === "action-proposed");
      check(
        "planned",
        planned.length >= 2,
        "Both become planned actions on the map",
        planned.map((a) => a.title),
      );
      await pageSame(s, check, "page-same", start);
      const docsBefore = await s.docs();
      await s.click(".map-pill-group button", "Run all");
      await s.win.waitForTimeout(2500);
      const waiting = await s.win.evaluate(() =>
        [...document.querySelectorAll(".map-action-waits")].map((e) => e.textContent),
      );
      check(
        "second-waits",
        waiting.includes("Next"),
        "The email waits for the FAQ (Next)",
        waiting,
      );
      await s.idle();
      await s.shot("done");
      const made = (await s.docs()).filter((d) => !docsBefore.includes(d));
      check("two-docs", made.length >= 2, "Each action makes its note", made);
      const faq = made.find((d) => /faq|question/i.test(d));
      const email = made.find((d) => d !== faq && /email|mail|announce|beta/i.test(d));
      const emailText = email ? await s.file(email) : "";
      const faqName = faq?.replace(/\.md$/, "") ?? "\0";
      check(
        "links-real-faq",
        !!faq &&
          !!email &&
          (emailText.includes(`[[${faqName}`) || emailText.includes(encodeURI(faqName))),
        "The email links to the FAQ note the first action actually made",
        { faq, email, links: [...emailText.matchAll(/\[\[[^\]]+\]\]/g)].map((m) => m[0]) },
      );
      const grew =
        section(await s.file(), "Launch steps").length - section(start, "Launch steps").length;
      check("plan-brief", grew <= 400, "The plan only gains short links, not the content", grew);
      const tools = (await s.threads()).flatMap((t) =>
        t.items.filter((i) => i.kind === "tool").map((i) => i.title ?? ""),
      );
      check(
        "nothing-outside",
        outside(tools).length === 0,
        "Nothing reached a service outside the folder",
        outside(tools),
      );
    },
  },
  {
    name: "actions-waits",
    about: "An action that waits on a choice: it says so, runs after the Use, and uses the pick",
    folder: FOLDER,
    async run(s, check) {
      await s.select("Pricing");
      await s.ask(
        "Give me three options for the paid tier. Once I've picked one, I'll want a pricing page drafted as a note in this folder, so set that up now but don't draft it yet.",
      );
      await s.shot("waiting");
      const planned = (await s.lines("docs")).filter((l) => l.kind === "action-proposed");
      check(
        "planned",
        planned.length >= 1,
        "The pricing page is a planned action",
        planned.map((a) => a.title),
      );
      const waits = await s.win.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".map-action-waits")].map((e) => e.title),
      );
      check(
        "says-waits",
        waits.some((w) => /pick/i.test(w)),
        "It shows it waits on the pick",
        waits,
      );
      const set = (await sets(s)).at(-1);
      const pick = set?.options[1];
      const others = (set?.options ?? []).filter((o) => o !== pick).map((o) => o.title);
      await s.click("aside.right-sidebar .think-offer button", /^Use$/, 1);
      await s.win.waitForTimeout(3000);
      // The prices the Use put in Pricing: the page should carry them.
      const usedPrices = [
        ...section(await s.file(), "Pricing").matchAll(/£\s?\d+(?:\.\d{1,2})?/g),
      ].map((m) => m[0].replace(/\s/g, ""));
      const docsBefore = await s.docs();
      const ran = await s.click(".map-pill button", /Run/);
      check("runs-after-use", ran, "After the Use it can run");
      await s.idle();
      await s.shot("ran");
      const made = (await s.docs()).filter((d) => !docsBefore.includes(d));
      const page = made[0] ? await s.file(made[0]) : "";
      const key = (t: string) =>
        t
          .toLowerCase()
          .replace(/[^a-z0-9£.]+/g, " ")
          .trim();
      check("page-made", made.length >= 1, "The pricing page is made", made);
      check(
        "uses-pick",
        usedPrices.length > 0 && usedPrices.every((p) => page.replace(/\s/g, "").includes(p)),
        "It's written for the pick: every price the Use put in Pricing is on the page",
        { pick: pick?.title, usedPrices },
      );
      check(
        "not-others",
        others.every((o) => !key(page).includes(key(o))),
        "It isn't written for an option passed over",
        others,
      );
    },
  },
  {
    name: "actions-check",
    about: "Check this section flags the one claim its linked notes contradict, and only that one",
    folder: FOLDER,
    async run(s, check) {
      const start = await s.file();
      await s.select("Risks");
      await s.click("aside.right-sidebar button", "Check this section");
      await s.idle();
      await s.shot("checked");
      const claims = (await s.lines("docs"))
        .filter((l) => l.kind === "check")
        .flatMap((l) => (l.claims ?? []) as { claim: string; verdict: string; source: string }[]);
      const users = claims.find((c) => /million/i.test(c.claim));
      check(
        "flags-wrong",
        users?.verdict === "wrong",
        "The 50 million users claim is flagged wrong",
        users,
      );
      check(
        "cites-notes",
        !!users && /market notes|3 million|2025/i.test(users.source),
        "…citing the market notes",
        users?.source,
      );
      const free = claims.find((c) => /free/i.test(c.claim) && !/million/i.test(c.claim));
      check("keeps-right", free?.verdict === "holds", "The free-plan claim holds", free);
      check(
        "only-one",
        claims.filter((c) => c.verdict === "wrong").length === 1,
        "Nothing else is called wrong",
        claims.map((c) => `${c.verdict}: ${c.claim}`),
      );
      const others = ["Growth", "Audience", "Pricing", "Launch steps"];
      const after = await s.file();
      check(
        "others-untouched",
        others.every((n) => section(after, n) === section(start, n)),
        "No other section changes",
      );
    },
  },
  {
    name: "actions-research",
    about:
      "Research from an attached sheet: a comparison note whose table matches the sheet, and price choices on the map",
    folder: FOLDER,
    async run(s, check) {
      const start = await s.file();
      const sheet = path.join(path.dirname(s.space), "competitors.csv");
      await writeFile(sheet, COMPETITORS);
      const docsBefore = await s.docs();
      const id = await s.startWith(
        "Pricing",
        "Use the attached competitor sheet to work out our pricing options. Put the comparison in its own note in this folder, and give me the price options to choose from.",
        [sheet],
      );
      await s.shot("research");
      const made = (await s.docs()).filter((d) => !docsBefore.includes(d));
      const note = made[0] ? await s.file(made[0]) : "";
      const rows = COMPETITORS.trim()
        .split("\n")
        .slice(1)
        .map((r) => r.split(","));
      check("note-made", made.length >= 1, "The comparison is its own note", made);
      check(
        "has-table",
        /^\|.*\|\s*$/m.test(note) && /^\|\s*:?-{3,}/m.test(note),
        "The note has a table",
      );
      const missing = rows.filter(([name, price]) => {
        const line = note.split("\n").find((l) => l.startsWith("|") && l.includes(name ?? "\0"));
        const p = Number(price);
        return (
          !line || !(p === 0 ? /\b(0|free|£0(\.00)?)\b/i.test(line) : line.includes(String(price)))
        );
      });
      check(
        "table-matches",
        missing.length === 0,
        "Every competitor is in the table at the sheet's price",
        missing.map((r) => r[0]),
      );
      const offered = (await sets(s)).filter((x) => x.thread === id || true).at(-1);
      check(
        "price-choices",
        !!offered && offered.options.length >= 2 && offered.options.length <= 4,
        "It offers 2–4 price choices on the map",
        offered?.options.map((o) => o.title),
      );
      check(
        "pricing-open",
        section(await s.file(), "Pricing") === section(start, "Pricing"),
        "The price isn't settled in the page before a pick",
      );
    },
  },
];
