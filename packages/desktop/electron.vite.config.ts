import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const root = path.resolve(import.meta.dirname, "..", "..");

export default defineConfig({
  // Main bundles its dependencies, @anur/core's TypeScript source included.
  // The agent host and the hook are entries of their own: the host runs in a
  // utilityProcess, and the hook is run by Claude Code with Electron as Node.
  main: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        input: {
          index: path.resolve(import.meta.dirname, "src/main/index.ts"),
          "agent-host": path.resolve(import.meta.dirname, "src/agent/host-process.ts"),
          hook: path.resolve(import.meta.dirname, "src/agent/hook.ts"),
          "mcp-server": path.resolve(import.meta.dirname, "src/agent/mcp-server.ts"),
          // The ACP adapter, bundled whole, so the packaged app carries it in out/.
          "acp-adapter": path.resolve(
            import.meta.dirname,
            "node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
          ),
        },
      },
    },
  },
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
