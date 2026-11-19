import { describe, expect, it } from "vitest";
import {
  citeOf,
  labelOf,
  moreSummary,
  reportItems,
  taskIdOf,
  taskTab,
  taskTitle,
  type TaskReport,
} from "./task-report.ts";

const line = (category: TaskReport["lines"][number]["category"], file: string) => ({
  category,
  repo: "api",
  part: null,
  file,
  line: 3,
  text: "x",
  how: "changed" as const,
});
const report: TaskReport = {
  id: "t1",
  session: "s",
  prompt: "Add a nightly job that retries failed payments",
  startedAt: "",
  endedAt: "",
  repos: [],
  lines: [
    line("ui", "a.tsx"),
    line("other", "README.md"),
    line("calls", "c.ts"),
    line("data", "m.sql"),
  ],
  choices: ["Run at 2am UTC"],
};

describe("the task tab's report (21.3, 21.4)", () => {
  it("ranks data, auth, calls, Claude's choices, UI, other", () => {
    expect(reportItems(report).map(labelOf)).toEqual([
      "Data",
      "Calls",
      "Claude's choice",
      "UI",
      "Other",
    ]);
  });

  it("says what's under more, and shows a report with no decisions or choices", () => {
    const items = reportItems(report);
    expect(moreSummary(items.slice(3))).toBe("1 UI · 1 other");
    expect(reportItems({ ...report, choices: [] }).map(labelOf)).toEqual([
      "Data",
      "Calls",
      "UI",
      "Other",
    ]);
  });

  it("names the tab path, the title and each line's place", () => {
    expect(taskIdOf(taskTab("t1"))).toBe("t1");
    expect(taskIdOf("docs/a.md")).toBeNull();
    expect(taskTitle(report)).toBe("Add a nightly job that retries failed payments");
    expect(citeOf(line("data", "m.sql"))).toBe("m.sql:3");
  });
});
