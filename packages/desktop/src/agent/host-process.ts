import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { claudeVersion, findClaude, loginPath } from "./find-claude.ts";
import { AgentHost } from "./host.ts";
import type { ToHost, ToMain } from "./protocol.ts";

/**
 * The agent host's utilityProcess entry (Architecture, "Processes"): it
 * wires an `AgentHost` to main's port. The adapter is a plain Node program
 * shipped beside the app, run with Electron itself acting as Node.
 */

const require = createRequire(import.meta.url);
const adapterPackage = require.resolve("@agentclientprotocol/claude-agent-acp/package.json");
const adapterVersion = (JSON.parse(readFileSync(adapterPackage, "utf8")) as { version: string })
  .version;

const port = process.parentPort;
const host = new AgentHost(
  (m: ToMain) => {
    port.postMessage(m);
  },
  {
    node: process.execPath,
    nodeEnv: { ELECTRON_RUN_AS_NODE: "1" },
    adapter: path.join(path.dirname(adapterPackage), "dist", "index.js"),
    adapterVersion,
    locate: async () => {
      const pathEnv = await loginPath();
      const claude = await findClaude(pathEnv);
      return { claude, version: claude ? await claudeVersion(claude) : null, path: pathEnv };
    },
  },
);

port.on("message", (e: { data: ToHost }) => {
  host.handle(e.data);
});
