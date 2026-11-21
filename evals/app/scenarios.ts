/**
 * The app eval's scenarios: a person working on a map with the agent, in the
 * built app. Each starts on a fresh copy of PLAN and records named checks; a
 * check states what should hold, so a failure says what broke. Found in a QA
 * pass on 2026-11-20 (Anur PRs 338, 339); `known` marks one not fixed yet.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Session } from "./app.ts";

export const PLAN = `# Launch Plan

We launch Tally, a shared expense tracker for flatmates, to our 400-person beta list in March.

## Audience

Flatmates aged 20–30 who split rent and bills. Most already use a group chat and a spreadsheet.

## Pricing

Free for up to 3 people in a flat. We haven't decided the paid tier yet.

## Launch steps

- Email the beta list
- Write the FAQ
- Post in two flat-hunting communities

## Risks

- Splitwise is free and well known.
- Bank linking may slip past March.
`;

export type Check = (id: string, holds: boolean, says: string, seen?: unknown) => void;

export type Scenario = {
  name: string;
  about: string;
  /** A check here is a known open issue: reported, not counted as a regression. */
  known?: Record<string, string>;
  run: (s: Session, check: Check) => Promise<void>;
};

const section = (doc: string, name: string) =>
  doc.split(`## ${name}`)[1]?.split(/\n## /)[0]?.trim() ?? "";

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "options",
    about: "Options on Pricing, Use one, then an edit that lands on its own and its Undo",
    known: { "use-history": "Use writes no History version (found 2026-11-20)" },
    async run(s, check) {
      await s.select("Pricing");
      await s.ask("What should the paid tier be? Give me three options to pick from.");
      await s.shot("options");
      const rows = await s.optionRows();
      check(
        "options-offered",
        rows.length >= 2,
        "The agent's options show as rows in the thread",
        rows,
      );
      check(
        "options-two-buttons",
        rows.every((r) => r.buttons.join(",") === "Use,Explore this"),
        "Each option offers only Use and Explore this",
        rows.map((r) => r.buttons),
      );
      check(
        "options-one-line",
        rows.every((r) => r.nameLines <= 1),
        "Each option's name stays on one line",
        rows.map((r) => r.nameLines),
      );
      const before = await s.file();
      await s.click("aside.right-sidebar .think-offer button", /^Use$/, 1);
      const after = await s.file();
      check(
        "use-writes",
        section(after, "Pricing") !== section(before, "Pricing"),
        "Use writes the option into Pricing",
      );
      const rowsAfter = await s.optionRows();
      check(
        "use-instead",
        rowsAfter
          .filter((r) => r.buttons.length > 0)
          .every((r) => r.buttons.join(",") === "Use instead,Explore this"),
        "The other options offer Use instead and Explore this",
        rowsAfter.map((r) => r.buttons),
      );
      check(
        "in-the-doc-one-line",
        rowsAfter.every((r) => r.labelLines <= 1),
        "“In the doc” beside the used option stays on one line",
        rowsAfter.map((r) => r.labelLines),
      );
      const versions = (await s.lines("docs")).filter(
        (l) => l.kind === "version" && l.cause !== "start",
      );
      check(
        "use-history",
        versions.length > 0,
        "Use leaves a version in the section's History",
        versions.length,
      );

      await s.ask("Add one line to Pricing: students get 20% off the paid tier.");
      await s.shot("landed");
      check("landed", (await s.file()).includes("20%"), "In auto mode the edit lands in the file");
      check(
        "no-toast",
        (await s.toasts()).length === 0,
        "No toast says the agent's edit was used",
        await s.toasts(),
      );
      const undone = await s.click("aside.right-sidebar .think-changed button", "Undo");
      check("row-undo", undone, "The thread's row for the landed edit has Undo");
      check(
        "undo-reverts",
        !(await s.file()).includes("20%"),
        "Undo takes the edit back out of the file",
      );
      check("taken-back", /taken back/.test(await s.think()), "The row then reads “taken back”");
    },
  },
  {
    name: "decisions",
    about:
      "A rewrite that states a decision, undo and redo from the map, and the decision in a later thread",
    async run(s, check) {
      await s.select("Risks");
      await s.ask(
        "Rewrite Risks so each risk has a mitigation, and add a risk about flats where one person never pays. We never offer a lifetime deal, so don't suggest one.",
      );
      await s.shot("rewrite");
      const rewritten = await s.file();
      check(
        "rewrite-lands",
        section(rewritten, "Risks").length > 120,
        "The rewrite lands in Risks",
      );
      const decisions = await s.lines("decisions");
      const d = decisions.find((x) => x.kind === "decision");
      check(
        "decision-saved",
        !!d,
        "The decision is saved in .anur/decisions/<person>.jsonl",
        decisions,
      );
      check(
        "decision-quote",
        typeof d?.quote === "string" &&
          "We never offer a lifetime deal, so don't suggest one.".includes(d.quote),
        "It keeps the person's exact words as its quote",
        d?.quote,
      );
      await s.key("Meta+z");
      check(
        "map-undo",
        (await s.file()).includes("- Splitwise is free and well known."),
        "⌘Z on the map takes the rewrite back",
      );
      await s.key("Meta+Shift+z");
      check("map-redo", (await s.file()) === rewritten, "⇧⌘Z brings it back");
      await s.newThread("Pricing");
      await s.ask(
        "Our first 100 users want something special. What could we offer them? One short paragraph.",
      );
      const threads = await s.lines("docs");
      // Naming the rule to say it's kept is fine ("without being a lifetime deal"); offering one isn't.
      const offers = (t: string) =>
        /lifetime/i.test(
          t.replace(/\b(no|not|never|without|isn't|rather than)\b(\W+\w+){0,3}?\W+lifetime/gi, ""),
        );
      const offered = threads
        .flatMap((l) =>
          l.kind === "options" ? (l.options as { title: string; text: string }[]) : [],
        )
        .map((o) => `${o.title} ${o.text}`);
      // Only what's offered counts: a reply often restates the rule it kept, in any words.
      check(
        "decision-followed",
        !offered.some(offers),
        "A later thread on the doc offers no lifetime deal",
        offered,
      );
      check(
        "threads-stored",
        threads.filter((l) => l.kind === "thread").length === 2,
        "Each thread is stored in its own .anur/docs/<doc>/threads/<id>/<device>.jsonl",
      );
    },
  },
  {
    name: "parts",
    about: "Options offered as parts to add or skip",
    async run(s, check) {
      await s.newThread("Risks");
      await s.ask(
        "Suggest four separate mitigations for the Splitwise risk that I can add or skip one by one, as parts rather than a single pick.",
      );
      await s.shot("parts");
      const rows = await s.optionRows();
      check(
        "parts-offered",
        rows.length >= 3 && rows.every((r) => r.buttons.join(",") === "Add,Skip"),
        "Parts show with Add and Skip",
        rows.map((r) => r.buttons),
      );
      check(
        "parts-one-line",
        rows.every((r) => r.nameLines <= 1),
        "Each part's name stays on one line",
      );
      await s.click("aside.right-sidebar .think-offer button", /^Add$/);
      await s.click("aside.right-sidebar .think-offer button", /^Skip$/, 1);
      const risks = section(await s.file(), "Risks");
      check(
        "part-added",
        /^### /m.test(risks),
        "An added part goes in as its own subsection",
        risks,
      );
      const after = await s.optionRows();
      check(
        "in-the-doc-one-line",
        after.every((r) => r.labelLines <= 1),
        "“In the doc” stays on one line",
        after.map((r) => r.labelLines),
      );
      check(
        "skipped",
        /Skipped “/.test(await s.think()),
        "A skipped part folds to one line with Undo",
      );
    },
  },
  {
    name: "plans",
    about: "Three planned actions with Run all, then two more run by Build this section",
    async run(s, check) {
      await s.newThread("Launch steps");
      await s.ask(
        "Turn these launch steps into three actions I can run: draft the beta email, write the FAQ, and draft the two community posts, each as a note in this folder, not in Gmail or any other service. Don't do them yet.",
      );
      check(
        "planned",
        (await s.pills()).some((p) => /3 planned/.test(p)),
        "Three actions show as planned",
        await s.pills(),
      );
      await s.click(".map-pill-group button", "Run all");
      await s.shot("running");
      const running = await s.pills();
      check(
        "next",
        running.filter((p) => / Next$/.test(p)).length === 2,
        "The two after the first say Next",
        running,
      );
      await s.idle();
      await s.shot("ran");
      check(
        "run-all-done",
        (await s.pills()).some((p) => /3 done/.test(p)),
        "Run all runs all three in turn",
        await s.pills(),
      );
      const made = (await s.docs()).length - 1;
      check(
        "run-all-docs",
        made === 3,
        "Each action makes its doc beside the plan",
        await s.docs(),
      );

      await s.newThread("Launch steps");
      await s.ask(
        "Plan two more actions here: a launch-day checklist note and a thank-you email draft for beta flats, each as a note in this folder, not in Gmail or any other service. Don't do them yet.",
      );
      await s.click("aside.right-sidebar .think-back", /.*/);
      const builds = (await s.threads()).filter((t) => t.purpose === "build").length;
      await s.click("aside.right-sidebar button", "Build this section");
      await s.idle();
      await s.shot("built");
      check(
        "build-runs-plan",
        (await s.pills()).some((p) => /5 done/.test(p)),
        "Build this section runs the section's planned actions",
        await s.pills(),
      );
      const after = (await s.threads()).filter((t) => t.purpose === "build");
      check(
        "no-free-build",
        after.length === builds + 2,
        "It starts one Build per planned action, no free-form Build",
        after.map((t) => t.title),
      );
      check(
        "nothing-planned",
        !(await s.pills()).some((p) => /planned|Run$/.test(p)),
        "Nothing built is left planned",
        await s.pills(),
      );
    },
  },
  {
    name: "layout",
    about:
      "Options on two neighbouring sections, and work in a lane: nothing on the map covers anything else",
    async run(s, check) {
      await s.win.locator(".map-box.title").first().click();
      await s.win.waitForTimeout(600);
      const titleOff = await s.handlesOff(".map-box.title.selected");
      check(
        "handles-on-line",
        titleOff.length === 4 && titleOff.every((d) => d < 0.75),
        "A selected box's handles sit on the line a person sees, the title's blue ring included",
        titleOff,
      );
      // Off the title, so its hover card doesn't cover Pricing.
      await s.win.mouse.move(5, 5);
      await s.win.waitForTimeout(800);
      await s.select("Pricing");
      await s.ask("What should the paid tier be? Give me three options to pick from.");
      const audience = await s.boxAt("Audience");
      // Pricing's every position while Audience's cards arrive, to see it glide.
      await s.win.evaluate(() => {
        const w = window as unknown as { pricingYs: number[] };
        w.pricingYs = [];
        const tick = () => {
          const el = [...document.querySelectorAll<HTMLElement>(".map-box[data-section]")].find(
            (e) => e.innerText.trim().startsWith("Pricing"),
          );
          const y = el ? parseFloat(el.style.top) : NaN;
          if (w.pricingYs.at(-1) !== y) w.pricingYs.push(y);
          requestAnimationFrame(tick);
        };
        tick();
      });
      await s.newThread("Audience");
      await s.ask(
        "Should students in university halls be part of the audience? Give me two options.",
      );
      const same = (a: { x: number; y: number } | null, b: typeof a) =>
        !!a && !!b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
      check(
        "grower-stays",
        same(audience, await s.boxAt("Audience")),
        "The section that got cards stays where it was; its neighbours make room",
        { before: audience, after: await s.boxAt("Audience") },
      );
      const ys = await s.win.evaluate(
        () => (window as unknown as { pricingYs: number[] }).pricingYs,
      );
      check(
        "slides",
        ys.length >= 4,
        "Pricing glides out of the way rather than jumping",
        ys.map(Math.round),
      );
      await s.win.locator(".map-tool, button", { hasText: /^Fit$/ }).first().click();
      await s.win.waitForTimeout(1500);
      await s.shot("two-sets");
      const hit = await s.overlaps();
      check(
        "no-overlap",
        hit.length === 0,
        "No box, choice card, fold or pill covers another",
        hit,
      );
      const pricing = await s.boxAt("Pricing");
      await s.click("aside.right-sidebar .think-offer button", /^Use$/);
      await s.shot("used");
      check(
        "use-holds-still",
        same(pricing, await s.boxAt("Pricing")),
        "When cards go (a Use), nothing else on the map moves",
        { before: pricing, after: await s.boxAt("Pricing") },
      );
      check(
        "no-overlap-after-use",
        (await s.overlaps()).length === 0,
        "Still nothing covers anything after the Use",
        await s.overlaps(),
      );
    },
  },
  {
    name: "think",
    about:
      "Think's other parts: the agent pickers, a section's history, and a thread whose section is gone",
    async run(s, check) {
      await s.select("Pricing");
      check(
        "pickers",
        (await s.win.locator("aside.right-sidebar .think-option").count()) > 0,
        "A new thread offers its agent and options pickers",
      );
      check(
        "history",
        (await s.win.locator("aside.right-sidebar .think-history").count()) > 0,
        "The section's History shows under it",
      );
      await s.newThread("Risks");
      await s.ask("Reply with the single word: ok.");
      check("replied", /\bok\b/i.test(await s.think()), "The agent replies in the thread");
      await writeFile(path.join(s.space, s.doc), PLAN.split("## Risks")[0] ?? PLAN);
      await s.win.waitForTimeout(5000);
      await s.click("aside.right-sidebar .think-back", /.*/);
      const orphaned = await s.win.evaluate(
        () => document.querySelector<HTMLElement>(".think-orphans summary")?.innerText ?? null,
      );
      check(
        "orphaned",
        orphaned === "Orphaned (1)",
        "A thread whose section was deleted outside Anur is kept under Orphaned",
        orphaned,
      );
    },
  },
];
