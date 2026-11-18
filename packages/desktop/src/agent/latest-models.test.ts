import { describe, expect, it } from "vitest";
import { latestModels } from "./latest-models.ts";

const menu = [
  "Default (recommended)",
  "Opus 5.5",
  "Fable 5.2",
  "Sonnet 5.5",
  "Haiku 5.5",
  "Fable 5.1",
  "Haiku 4.5",
  "Sonnet 5",
  "Opus 5",
  "Fable 5",
  "Opus 4.8",
  "Opus 4.7",
  "Opus 4.6",
  "Sonnet 4.6",
].map((name) => ({ value: name.toLowerCase().replace(/\W+/g, "-"), name, description: null }));
const names = (cs: { name: string }[]) => cs.map((c) => c.name);

describe("the model menu", () => {
  it("keeps the newest of each family", () => {
    expect(names(latestModels(menu, "opus-5-5"))).toEqual([
      "Opus 5.5",
      "Fable 5.2",
      "Sonnet 5.5",
      "Haiku 5.5",
    ]);
  });

  it("keeps the current pick, even an older model or the default", () => {
    expect(names(latestModels(menu, "opus-4-7"))).toContain("Opus 4.7");
    expect(names(latestModels(menu, "default-recommended-"))).toContain("Default (recommended)");
  });

  it("leaves a menu with no versioned names as it came", () => {
    const plain = [{ value: "a", name: "Fast", description: null }];
    expect(latestModels(plain, "a")).toEqual(plain);
  });
});
