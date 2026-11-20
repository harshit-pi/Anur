import { atLeast, KIRO_MIN } from "../../agent/adapters.ts";
import {
  claudeVersion,
  findClaude,
  findKiro,
  kiroVersion,
  loginPath,
} from "../../agent/find-claude.ts";
import { AGENT_IDS, AGENTS, type AgentId } from "../../shared/agents.ts";
import type { AgentRow } from "../../shared/ipc-contract.ts";

/**
 * Settings → Agents: every agent that can run threads, found on this Mac or
 * not, with its version and, when it can't run, the one thing to do about it.
 */
export async function agentRows(on: readonly AgentId[]): Promise<AgentRow[]> {
  const pathEnv = await loginPath();
  const rows = AGENT_IDS.filter((id) => AGENTS[id].listed === "available").map(async (id) => {
    const base = { id, name: AGENTS[id].name, on: on.includes(id), soon: false };
    if (id === "kiro") {
      const kiro = await findKiro(pathEnv);
      const version = kiro ? await kiroVersion(kiro) : null;
      if (!kiro)
        return { ...base, ready: false, version, fix: "Install Kiro CLI, then run kiro-cli login" };
      if (!version || !atLeast(version, KIRO_MIN))
        return {
          ...base,
          ready: false,
          version,
          fix: `Needs Kiro CLI ${KIRO_MIN} or later. Run kiro-cli update`,
        };
      return { ...base, ready: true, version, fix: null };
    }
    const claude = await findClaude(pathEnv);
    const version = claude ? await claudeVersion(claude) : null;
    return claude
      ? { ...base, ready: true, version, fix: null }
      : {
          ...base,
          ready: false,
          version,
          fix: "Install Claude Code, then sign in once in a terminal",
        };
  });
  // Switched on but not here to run, such as Claude Code before it's installed: off, with its fix.
  const found = (await Promise.all(rows)).map((r) => ({ ...r, on: r.on && r.ready }));
  return [
    ...found,
    ...SOON.map((id) => ({
      id,
      name: AGENTS[id].name,
      on: false,
      ready: false,
      soon: true,
      version: null,
      fix: null,
    })),
  ];
}

/** Agents listed as coming (shared/agents.ts says which). */
const SOON = AGENT_IDS.filter((id) => AGENTS[id].listed === "soon");
