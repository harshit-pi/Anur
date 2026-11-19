/**
 * Runs the carry eval. It loads the app's own classes, which plain Node's
 * type stripping can't, so it bundles run.ts first with Rolldown (Vite's own
 * bundler, already installed), then runs the bundle with the same arguments.
 *
 *   pnpm eval:carry [runs] [--no-model]
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const desktop = createRequire(path.join(root, "packages/desktop/package.json"));
const viteRequire = createRequire(desktop.resolve("vite"));
const { build } = await import(pathToFileURL(viteRequire.resolve("rolldown")).href);
const out = path.join(import.meta.dirname, ".build", "run.mjs");
await build({
  input: path.join(import.meta.dirname, "run.ts"),
  platform: "node",
  external: ["electron", "@agentclientprotocol/sdk"],
  logLevel: "silent",
  output: { file: out, format: "esm" },
});
process.chdir(root);
await import(pathToFileURL(out).href);
