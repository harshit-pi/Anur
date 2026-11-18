import { describe, expect, it } from "vitest";
import { listOf, stepOf } from "./step-label.ts";

const DIR = "/private/tmp/x/walk/Tally";

describe("stepOf", () => {
  it("says what a shell step did, without the cd into the folder", () => {
    expect(stepOf(`cd ${DIR}; cat "Archive/Competitor prices 2025.md"`)).toEqual({
      label: "Read Competitor prices 2025.md",
      read: ["Competitor prices 2025.md"],
    });
    expect(stepOf(`cd "${DIR}" && cat competitors.txt; echo ---; cat beta.csv`).label).toBe(
      "Read competitors.txt and beta.csv",
    );
    expect(stepOf(`cd ${DIR}; rg -in "android|ios"`).label).toBe("Searched the folder");
    expect(stepOf(`cd ${DIR}; ls -la && ls specs`).label).toBe("Looked through the folder");
    expect(stepOf(`cd ${DIR}; python3 x.py`).label).toBe("Ran python3");
  });

  it("names an agent tool's file by its name only", () => {
    expect(stepOf(`Read ${DIR}/beta.csv`).label).toBe("Read beta.csv");
    expect(stepOf("Write working copy of launch-email.md").label).toBe("Wrote launch-email.md");
    expect(stepOf("Edit working copy of Launch.md").label).toBe("Edited Launch.md");
    expect(stepOf("Grep android").label).toBe("Searched the folder");
  });
});

describe("listOf", () => {
  it("names two, then counts the rest", () => {
    expect(listOf(["a", "b"])).toBe("a and b");
    expect(listOf(["a", "b", "c", "a"])).toBe("a, b and 1 more");
  });
});
