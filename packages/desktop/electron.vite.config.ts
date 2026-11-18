import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const root = path.resolve(import.meta.dirname, "..", "..");

/**
 * Excalidraw draws in its own fonts, which it fetches from a CDN unless they
 * sit beside the page. Copied into the renderer's public folder (not checked
 * in), the Latin ones only: Xiaolai, for Chinese script, alone is 12 MB.
 */
const EXCALIDRAW_FONTS = [
  "Excalifont",
  "Virgil",
  "Nunito",
  "Cascadia",
  "Lilita",
  "ComicShanns",
  "Liberation",
  "Assistant",
];
function excalidrawFonts() {
  const from = path.resolve(
    import.meta.dirname,
    "node_modules/@excalidraw/excalidraw/dist/prod/fonts",
  );
  const to = path.resolve(import.meta.dirname, "src/renderer/public/excalidraw/fonts");
  return {
    name: "anur-excalidraw-fonts",
    buildStart() {
      for (const f of EXCALIDRAW_FONTS)
        if (existsSync(path.join(from, f)))
          cpSync(path.join(from, f), path.join(to, f), { recursive: true });
    },
  };
}

export default defineConfig({
  // Main bundles its dependencies, @anur/core's TypeScript source included.
  // The agent host, the index process and the hook are entries of their own:
  // the host and the index run in a utilityProcess, and the hook is run by Claude Code with Electron as Node.
  main: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        input: {
          index: path.resolve(import.meta.dirname, "src/main/index.ts"),
          "agent-host": path.resolve(import.meta.dirname, "src/agent/host-process.ts"),
          "index-process": path.resolve(import.meta.dirname, "src/main/index-process/entry.ts"),
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
    plugins: [react(), excalidrawFonts()],
    publicDir: path.resolve(import.meta.dirname, "src/renderer/public"),
    // brand/tokens.css lives at the repo root.
    server: { fs: { allow: [root] } },
  },
});
