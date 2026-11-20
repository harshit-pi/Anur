import { configDefaults, defineConfig } from "vitest/config";

// Browser tests need real layout and run on their own: pnpm test:browser.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "**/*.browser.test.ts"] },
});
