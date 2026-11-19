/**
 * Icons for the services an agent acts in: a step that files a Linear issue
 * or drafts in Gmail shows that service's mark, so a thread reads at a
 * glance. The marks are Simple Icons (CC0, simpleicons.org), drawn in each
 * brand's colour. A service with no mark there (Slack, Outlook and Teams
 * asked to be left out) or one Anur doesn't know gets a plain action mark.
 */
import {
  siAsana,
  siClickup,
  siConfluence,
  siDiscord,
  siFigma,
  siGithub,
  siGmail,
  siGooglecalendar,
  siGoogledocs,
  siGoogledrive,
  siGooglesheets,
  siHubspot,
  siIntercom,
  siJira,
  siLinear,
  siMiro,
  siNotion,
  siPosthog,
  siSentry,
  siStripe,
  siSupabase,
  siTrello,
  siVercel,
  siZoom,
} from "simple-icons";

type Mark = { title: string; path: string; hex: string };

/** By the words a service's tools are named with, lowercased. */
const MARKS: Record<string, Mark> = {
  asana: siAsana,
  clickup: siClickup,
  confluence: siConfluence,
  discord: siDiscord,
  figma: siFigma,
  github: siGithub,
  gmail: siGmail,
  google_calendar: siGooglecalendar,
  googlecalendar: siGooglecalendar,
  calendar: siGooglecalendar,
  google_docs: siGoogledocs,
  google_drive: siGoogledrive,
  googledrive: siGoogledrive,
  drive: siGoogledrive,
  google_sheets: siGooglesheets,
  hubspot: siHubspot,
  intercom: siIntercom,
  jira: siJira,
  atlassian: siJira,
  linear: siLinear,
  miro: siMiro,
  notion: siNotion,
  posthog: siPosthog,
  sentry: siSentry,
  stripe: siStripe,
  supabase: siSupabase,
  trello: siTrello,
  vercel: siVercel,
  zoom: siZoom,
};

/** Names for services with no mark, so their steps still read as the service. */
const NAMES: Record<string, string> = {
  slack: "Slack",
  outlook: "Outlook",
  microsoft_outlook: "Outlook",
  teams: "Teams",
  microsoft_teams: "Teams",
  canva: "Canva",
  sharepoint: "SharePoint",
};

export type Service = { key: string; name: string; mark: Mark | null };

/** The service a step's tool belongs to, from its MCP name ("mcp__claude_ai_Linear__save_issue"). */
export function serviceOf(title: string): (Service & { action: string }) | null {
  const m = /^mcp__([A-Za-z0-9_.-]+?)__([A-Za-z0-9_-]+)/.exec(title);
  if (!m || m[1] === "anur") return null;
  const server = (m[1] ?? "").replace(/^claude_ai_/i, "").replace(/^plugin_[^_]+_/i, "");
  const key = server.toLowerCase();
  const mark = MARKS[key] ?? MARKS[key.split("_")[0] ?? ""] ?? null;
  const name =
    mark?.title ?? NAMES[key] ?? server.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const action = (m[2] ?? "")
    .replace(new RegExp(`^${key}_`, "i"), "")
    .replace(/_/g, " ")
    .trim();
  return { key, name, mark, action };
}

/** A service's mark, or the plain action mark when it has none. */
export function ServiceIcon({ service }: { service: Service | null }) {
  const mark = service?.mark;
  return mark ? (
    <svg
      className="service-icon"
      viewBox="0 0 24 24"
      role="img"
      aria-label={mark.title}
      style={{ fill: `#${mark.hex}` }}
    >
      <path d={mark.path} />
    </svg>
  ) : (
    <svg className="service-icon action" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  );
}

/** The services a thread acted in, in the order it first used them: what its map chip shows. */
export function servicesUsed(items: readonly { kind: string; title?: string }[]): Service[] {
  const seen = new Map<string, Service>();
  for (const i of items) {
    if (i.kind !== "tool" || !i.title) continue;
    const s = serviceOf(i.title);
    if (s && !seen.has(s.name)) seen.set(s.name, { key: s.key, name: s.name, mark: s.mark });
  }
  return [...seen.values()];
}
