import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isAgentId, type AgentId } from "../../shared/agents.ts";
import type { SessionOption } from "../../agent/protocol.ts";
import { writeFileAtomic } from "../../vault/anur-folder.ts";

/**
 * Each agent's mode and model choices, as its last session reported them,
 * kept in app support: a new thread shows them before its first message,
 * and a thread's picks make the defaults for the next (3.5).
 */
export class AgentChoices {
  private all: Partial<Record<AgentId, SessionOption[]>> = {};

  constructor(private readonly appSupport: string) {}

  private get file() {
    return path.join(this.appSupport, "agent", "choices.json");
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as Record<string, unknown>;
      for (const [id, options] of Object.entries(raw))
        if (isAgentId(id) && Array.isArray(options)) this.all[id] = options as SessionOption[];
    } catch {
      this.all = {};
    }
  }

  get(agent: AgentId): SessionOption[] {
    return this.all[agent] ?? [];
  }

  async set(agent: AgentId, options: SessionOption[]): Promise<void> {
    if (options.length === 0) return;
    this.all[agent] = options;
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFileAtomic(this.file, JSON.stringify(this.all, null, 1));
  }
}
