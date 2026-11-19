/**
 * The scenarios the brainstorm eval runs (group 30): five kinds of plan, each
 * started as a doc with only its title, as a person would on the map. Each
 * says what the person asks at each step, so a run is the same every time and
 * only the agent varies.
 *
 * - decide: a choice the person has to make about the plan, asked on the
 *   title. It should come back as options, named by a heading, since the
 *   choice isn't the title itself.
 * - parts: a list of things that all belong. It should come back as a set
 *   the person adds any of ("several"), not a choice of one.
 * - workRule: a rule about how the agent works. It should be recorded as a
 *   decision that concerns the work.
 * - pick: which of the decision's options the person uses; the others are
 *   then passed over, and a new thread should never name them.
 * - risk: what the person asks in that new thread.
 * - write: a section to write while a work rule holds; the rule's words
 *   (ruleWords) should never appear in it.
 */

export type Scenario = {
  name: string;
  title: string;
  decide: string;
  parts: string;
  workRule: string;
  pick: number;
  risk: string;
  /** A rule about the work that holds while the section is written. */
  rule: string;
  ruleWords: RegExp;
  write: string;
};

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "launch",
    title: "Referral Launch",
    decide:
      "Our referral program (free stock for both sides) is meant to go live in two weeks, but compliance hasn't signed anything. How should we set the launch date?",
    parts: "What are the workstreams we need running to launch this?",
    workRule:
      "From now on, don't create anything in Linear or Gmail for this; keep task lists here in the doc.",
    pick: 0,
    risk: "What's the biggest risk with this, and what should we do first?",
    rule: "Never create Linear issues or Gmail drafts for this launch; keep task lists in the doc.",
    ruleWords: /\b(linear|gmail)\b/i,
    write:
      "Write this section's text: the build tasks for launch week, one line each. Reply with the text only.",
  },
  {
    name: "engineering",
    title: "Webhook Retries",
    decide:
      "Our webhook deliveries fail about 2% of the time and we drop them. How should we retry them?",
    parts: "What pieces do we need to build for this?",
    workRule: "Don't run or change any code in the repos for this; we're only planning here.",
    pick: 1,
    risk: "What could go wrong with this approach?",
    rule: "Don't run or change any code in the repos; this is planning only.",
    ruleWords: /\b(planning only|don'?t (run|change) (any )?code|no code changes)\b/i,
    write: "Write this section's text: the rollout steps, one line each. Reply with the text only.",
  },
  {
    name: "hiring",
    title: "First PM Hire",
    decide:
      "We're hiring our first product manager. Should they be senior or early-career, and where do we find them?",
    parts: "What do we need in place before we open the role?",
    workRule:
      "Don't post anything or message candidates on LinkedIn or anywhere else; drafts only.",
    pick: 0,
    risk: "What's most likely to go wrong in this search?",
    rule: "Never post or message anyone on LinkedIn or elsewhere; drafts only.",
    ruleWords: /\b(drafts only|never post|don'?t (post|message))\b/i,
    write:
      "Write this section's text: the interview loop, one line per stage. Reply with the text only.",
  },
  {
    name: "research",
    title: "Pricing Study",
    decide:
      "We want to learn whether to move from per-seat to usage pricing. How should we study it?",
    parts: "What questions does the study need to answer?",
    workRule: "Only use what's in this folder for this; don't search the web.",
    pick: 2,
    risk: "Where could this study mislead us?",
    rule: "Use only what's in this folder; don't search the web.",
    ruleWords: /\b(this folder|don'?t search the web|no web search)\b/i,
    write:
      "Write this section's text: the study plan, one line per step. Reply with the text only.",
  },
  {
    name: "shouldnt-build",
    title: "Dark Mode for Reports",
    decide:
      "One customer asked for dark mode on PDF reports. Two others have never mentioned it. What should we do about it?",
    parts: "What would we need to know before deciding?",
    workRule: "Don't open tickets anywhere for this; keep it in this doc.",
    pick: 0,
    risk: "What would make this the wrong call?",
    rule: "Don't open tickets anywhere; keep it in this doc.",
    ruleWords: /\b(tickets?|keep it in this doc)\b/i,
    write: "Write this section's text: the decision and its reason. Reply with the text only.",
  },
];
