import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Tests that need real layout (the editor's line positions), in headless Chromium.
// Local only, not in CI: pnpm test:browser (first run: npx playwright install --only-shell chromium).
export default defineConfig({
  test: {
    include: ["src/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
