import { describe, expect, it } from "vitest";
import { staleFor } from "./stale-page.ts";

const before = "# Anur\n\n## Vision\n\n## Build Plan\n\n## Hosted and Teams\n";
const now = "# Anur\n\n## Vision\n";

describe("staleFor (30.43)", () => {
  it("finds a page made for a section removed while the thread ran", () => {
    expect(staleFor("Anur - Build Plan.md", "# Build Plan\n", "Anur.md", before, now)).toBe(
      "build plan",
    );
    expect(
      staleFor("Teams.md", "Back to [[Anur#Hosted and Teams]]\n", "Anur.md", before, now),
    ).toBe("hosted and teams");
  });

  it("keeps a page whose section is still there, or that no removed section names", () => {
    expect(staleFor("Anur - Vision.md", "[[Anur#Vision]]\n", "Anur.md", before, now)).toBeNull();
    expect(staleFor("Pricing.md", "# Pricing\n", "Anur.md", before, now)).toBeNull();
    expect(
      staleFor("Anur - Build Plan.md", "# Build Plan\n", "Anur.md", before, before),
    ).toBeNull();
  });
});
