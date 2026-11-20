import path from "node:path";
import adapterPackage from "@agentclientprotocol/claude-agent-acp/package.json" with { type: "json" };
import { claudeCode, kiro } from "./adapters.ts";
import { claudeVersion, findClaude, findKiro, kiroVersion, loginPath } from "./find-claude.ts";
import { kiroDir, kiroHookInstalled } from "./kiro-hook.ts";
import { AgentHost } from "./host.ts";
import type { ToHost, ToMain } from "./protocol.ts";

/**
 * The agent host's utilityProcess entry (Architecture, "Processes"): it
 * wires an `AgentHost` to main's port, with every agent Anur can drive.
 * Claude Code's ACP adapter and the hook are built beside it in `out/main/`,
 * so the packaged app carries both (3.14), and run with Electron as Node.
 */

const here = import.meta.dirname;
const node = process.execPath;
const nodeEnv = { ELECTRON_RUN_AS_NODE: "1" };
const port = process.parentPort;
const hook = path.join(here, "hook.js");
/** Main names the app's data folder: Anur's and Anur Dev's differ. */
const kiroFolder = kiroDir(process.env.ANUR_USER_DATA ?? path.join(here, ".."));
const host = new AgentHost(
  (m: ToMain) => {
    port.postMessage(m);
  },
  {
    node,
    nodeEnv,
    hook,
    adapters: {
      "claude-code": claudeCode({
        node,
        nodeEnv,
        adapter: path.join(here, "acp-adapter.js"),
        adapterVersion: adapterPackage.version,
        locate: async () => {
          const pathEnv = await loginPath();
          const claude = await findClaude(pathEnv);
          return { claude, version: claude ? await claudeVersion(claude) : null, path: pathEnv };
        },
      }),
      kiro: kiro({
        dir: kiroFolder,
        locate: async () => {
          const pathEnv = await loginPath();
          const found = await findKiro(pathEnv);
          return { kiro: found, version: found ? await kiroVersion(found) : null, path: pathEnv };
        },
        hookInstalled: () => kiroHookInstalled(kiroFolder, process.env.ANUR_APP_EXEC ?? node, hook),
      }),
    },
  },
);

port.on("message", (e: { data: ToHost }) => {
  host.handle(e.data);
});
