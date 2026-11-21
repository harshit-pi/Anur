/**
 * A folder's standard plugins as its threads' agents see them: one context
 * line each, the actions an agent may run through anur_plugin_action, and
 * the Git plugin syncing after an agent pushed by hand.
 */

/** A standard plugin running in this folder, as an agent may use it. */
export type StandardPlugin = {
  id: string;
  name: string;
  what: string;
  /** Its status bar text now, such as "Synced 3m ago"; null for none. */
  status: string | null;
  /** The actions its manifest offers, the ones an agent may run. */
  actions: { id: string; label: string }[];
};

/** The Git plugin's ID: it commits the whole folder, `.anur/` included. */
export const GIT = "git";

/** The lines a thread's bundle carries about the folder's plugins, or null for none. */
export function pluginContext(
  plugins: readonly StandardPlugin[],
): { label: string; lines: string[] } | null {
  if (plugins.length === 0) return null;
  const lines = plugins.map((p) => {
    const now = p.status ? ` Now: ${p.status}.` : "";
    const acts = p.actions.map((a) => `${a.id} (${a.label})`).join(", ");
    const run = acts ? ` Run with anur_plugin_action: ${acts}.` : "";
    const git =
      p.id === GIT
        ? " It commits and pushes everything in this folder, .anur/ included, so to put the folder on GitHub or push it, use these rather than git push or gh repo create. If you do push by hand, Anur syncs through it when your turn ends, so .anur/ follows."
        : "";
    return `${p.name}: ${p.what}${now}${run}${git}`;
  });
  return { label: "Plugins on in this folder", lines };
}

/** An agent's anur_plugin_action call, checked against what's running here. */
export function checkAction(
  plugins: readonly StandardPlugin[],
  args: unknown,
): { plugin: StandardPlugin; action: string } | { error: string } {
  const a = (args ?? {}) as { plugin?: unknown; action?: unknown };
  const id = typeof a.plugin === "string" ? a.plugin.trim().toLowerCase() : "";
  const plugin = plugins.find((p) => p.id === id || p.name.toLowerCase() === id);
  if (!plugin) {
    const on = plugins.map((p) => p.id).join(", ");
    return {
      error: on
        ? `No plugin ${id || "named"} is on here; on: ${on}.`
        : "No plugins are on in this folder.",
    };
  }
  const action = typeof a.action === "string" ? a.action.trim() : "";
  if (!plugin.actions.some((x) => x.id === action))
    return {
      error: `${plugin.name} has no action ${action || "named"}; it has ${plugin.actions.map((x) => x.id).join(", ") || "none"}.`,
    };
  return { plugin, action };
}

/** A shell command that pushes to a remote by hand: git push, or gh repo create with --push. */
export function pushesByHand(command: string): boolean {
  return command.split(/&&|\|\||[;|\n]/).some((part) => {
    const p = part.trim();
    return (
      /^(?:\S+=\S*\s+)*git(?:\s+-C\s+\S+|\s+-c\s+\S+)*\s+push\b/.test(p) ||
      /^gh\s+repo\s+create\b.*--push\b/.test(p)
    );
  });
}

/**
 * Whether a turn pushed, by hand or through Git's actions: either way its own
 * last lines are written after, so a sync at its end takes them up too.
 */
export function turnPushed(tools: Iterable<{ input?: unknown; name?: string | null }>): boolean {
  for (const t of tools) {
    const input = (t.input ?? {}) as { command?: unknown; plugin?: unknown };
    if (typeof input.command === "string" && pushesByHand(input.command)) return true;
    if (t.name?.endsWith("anur_plugin_action") && String(input.plugin).toLowerCase() === GIT)
      return true;
  }
  return false;
}
