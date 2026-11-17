import { describe, expect, it } from "vitest";
import { Section, formatPath, ownText, subtreeText } from "./section.ts";

const FILE = [
  "# Failed-payment notifications",
  "",
  "Notify customers when a card payment fails.",
  "",
  "## Retry timing",
  "",
  "Retry after 1 hour, then 24 hours. See [[#Notification channel|channel]].",
  "",
  "### Edge cases",
  "",
  "Cards that expire mid-retry.",
  "",
  "## Notification channel",
  "",
  "Email first.",
  "",
].join("\n");

const at = (s: string) => FILE.indexOf(s);
const retryFrom = at("## Retry timing");
const edgeFrom = at("### Edge cases");
const channelFrom = at("## Notification channel");
const linkFrom = at("[[#Notification");
const linkTo = at("]].") + 2;

/** "Retry timing", as task 1.4 will build it. */
const retry = {
  id: "s-retry",
  doc: "d-1",
  source: "markdown",
  path: ["Failed-payment notifications", "Retry timing"],
  level: 2,
  ordinal: 0,
  order: 0,
  headingRange: { from: retryFrom, to: retryFrom + "## Retry timing".length },
  ownRange: { from: retryFrom, to: edgeFrom },
  subtreeRange: { from: retryFrom, to: channelFrom },
  linksOut: [
    {
      range: { from: linkFrom, to: linkTo },
      target: "",
      heading: "Notification channel",
      alias: "channel",
      embed: false,
      resolved: "s-channel",
    },
  ],
  linksIn: ["s-other"],
};

describe("the section record", () => {
  it("accepts a well-formed section", () => {
    const s = Section.parse(retry);
    expect(s.id).toBe("s-retry");
    expect(formatPath(s.path)).toBe("Failed-payment notifications > Retry timing");
  });

  it("reads its text through the ranges, never storing it", () => {
    const s = Section.parse(retry);
    expect(ownText(FILE, s)).toBe(FILE.slice(retryFrom, edgeFrom));
    expect(ownText(FILE, s)).not.toContain("Edge cases");
    expect(subtreeText(FILE, s)).toContain("### Edge cases");
    expect(subtreeText(FILE, s)).not.toContain("Notification channel\n");
    expect(Object.values(s)).not.toContain(ownText(FILE, s));
  });

  it("accepts a title section with no H1, and a plugin's own source", () => {
    const title = {
      ...retry,
      path: ["notes"],
      level: 1,
      headingRange: null,
      ownRange: { from: 0, to: 10 },
      subtreeRange: { from: 0, to: 50 },
      linksOut: [],
      source: "repo",
    };
    expect(Section.safeParse(title).success).toBe(true);
  });

  it.each([
    ["an empty id", { id: "" }],
    ["an empty path", { path: [] }],
    ["level 0", { level: 0 }],
    ["level 7", { level: 7 }],
    ["a negative ordinal", { ordinal: -1 }],
    ["a fractional order", { order: 1.5 }],
    ["a backwards range", { ownRange: { from: 10, to: 5 } }],
    ["own and subtree starting apart", { ownRange: { from: retryFrom + 1, to: edgeFrom } }],
    ["own text past the subtree", { ownRange: { from: retryFrom, to: channelFrom + 1 } }],
    [
      "a heading that doesn't start the section",
      { headingRange: { from: retryFrom + 1, to: retryFrom + 5 } },
    ],
    [
      "a link outside the own text",
      { linksOut: [{ ...retry.linksOut[0], range: { from: edgeFrom + 1, to: edgeFrom + 5 } }] },
    ],
    ["an upper-case source", { source: "Markdown" }],
  ])("rejects %s", (_, change) => {
    expect(Section.safeParse({ ...retry, ...change }).success).toBe(false);
  });
});
