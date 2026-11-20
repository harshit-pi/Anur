import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prDescriptionProblems } from "./pr-description.ts";

const template = readFileSync(
  new URL("../../../../.github/pull_request_template.md", import.meta.url),
  "utf8",
);
const filled = `## What changes, and why

Choices can be dragged on the map.

## Release note

Drag choices around the map like sections.

## How it was checked

- [x] \`pnpm check\` passes
`;

describe("a PR description", () => {
  it("passes when it fills the template", () => {
    expect(prDescriptionProblems(filled)).toEqual([]);
  });

  it("takes none for a release note nobody will notice", () => {
    expect(
      prDescriptionProblems(
        filled.replace("Drag choices around the map like sections.", "None: CI only."),
      ),
    ).toEqual([]);
  });

  it("fails the template left unfilled: the hints don't count", () => {
    const problems = prDescriptionProblems(template);
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toMatch(/What changes, and why/);
    expect(problems.join(" ")).toMatch(/Release note/);
  });

  it("names each missing section, as gh pr create --body leaves it", () => {
    const problems = prDescriptionProblems("Map: drag a choice.\n\nTests pass.");
    expect(problems).toHaveLength(3);
    expect(problems[1]).toMatch(/## Release note/);
  });
});
