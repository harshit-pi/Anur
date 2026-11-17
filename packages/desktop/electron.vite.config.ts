import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const root = path.resolve(import.meta.dirname, "..", "..");

export default defineConfig({
  // Main bundles its dependencies, @anur/core's TypeScript source included.
  main: { build: { externalizeDeps: false } },
  // A sandboxed preload can't load modules, so it is one CommonJS file.
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    plugins: [react()],
    // brand/tokens.css lives at the repo root.
    server: { fs: { allow: [root] } },
  },
});
