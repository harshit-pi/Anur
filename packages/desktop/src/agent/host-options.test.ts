import { describe, expect, it } from "vitest";
import { optionsOf } from "./host.ts";

describe("an agent's session choices", () => {
  it("lists the agent's own modes, not the person's custom agents or hidden entries", () => {
    const kiro = (source: string) => ({ kiro: { source } });
    const [mode] = optionsOf([
      {
        type: "select",
        id: "mode",
        name: "Mode",
        category: "mode",
        currentValue: "vibe",
        options: [
          { value: "vibe", name: "Default", _meta: kiro("bundled") },
          { value: "plan", name: "Plan", _meta: kiro("bundled") },
          { value: "kirocrew-lite", name: "kirocrew-lite", _meta: kiro("global") },
          { value: ".kirocrew-skill-projection-metadata/x", name: ".x", _meta: kiro("global") },
        ],
      },
    ]);
    expect(mode?.choices.map((c) => c.name)).toEqual(["Default", "Plan"]);
  });

  it("keeps a mode with no source, as Claude Code's are", () => {
    const [mode] = optionsOf([
      {
        type: "select",
        id: "mode",
        name: "Mode",
        category: "mode",
        currentValue: "default",
        options: [
          { value: "default", name: "Default" },
          { value: "plan", name: "Plan" },
        ],
      },
    ]);
    expect(mode?.choices).toHaveLength(2);
  });
});
