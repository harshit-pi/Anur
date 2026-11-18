/**
 * The Core features as modules (group 12; Architecture, "Features as
 * modules"): one registry, read by Settings, the page and main. Two are
 * always on; the rest have a switch, kept in app settings. There is no
 * plugin API yet: it is cut along these lines when the engineering plugin
 * comes.
 */
export const FEATURES = [
  {
    id: "page-map",
    name: "Page and map",
    what: "Every doc as a page and as a map drawn from its headings: boxes to move, add, link and open.",
    always: true,
  },
  {
    id: "think",
    name: "Think",
    what: "Threads on each section, each its own chat with your agent: options to pick, edits to use, its inputs kept.",
    always: true,
  },
  {
    id: "links",
    name: "Links as context",
    what: "A link to another section draws a line on the map and adds the linked text to what a thread reads. Off, threads read their own doc only.",
    always: false,
  },
  {
    id: "history",
    name: "Section history",
    what: "Keeps every version of a section's text, with Restore in Think. Off, no new versions are written and History hides; those kept stay.",
    always: false,
  },
  {
    id: "actions",
    name: "Build and check",
    what: "Build this section and Check this section in Think: your agent builds what a section decides, or tests its claims against its sources.",
    always: false,
  },
] as const;

export type FeatureId = (typeof FEATURES)[number]["id"];
export type SwitchableId = Extract<(typeof FEATURES)[number], { always: false }>["id"];
export type FeatureFlags = Record<SwitchableId, boolean>;

export const SWITCHABLE: SwitchableId[] = ["links", "history", "actions"];

export const isSwitchable = (id: string): id is SwitchableId =>
  (SWITCHABLE as string[]).includes(id);

/** Every switchable module is on until it's turned off. */
export const DEFAULT_FLAGS: FeatureFlags = { links: true, history: true, actions: true };

/**
 * The flags in saved settings; anything missing or not a yes-or-no is on.
 * `sectionHistory` is the switch from before the registry, read once.
 */
export function flagsFrom(raw: unknown, legacy: { sectionHistory?: unknown } = {}): FeatureFlags {
  const saved = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const flags = { ...DEFAULT_FLAGS };
  if (typeof legacy.sectionHistory === "boolean") flags.history = legacy.sectionHistory;
  for (const id of SWITCHABLE) if (typeof saved[id] === "boolean") flags[id] = saved[id];
  return flags;
}
