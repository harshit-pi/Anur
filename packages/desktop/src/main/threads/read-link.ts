/**
 * A link a person added, read when a thread asks for it (10.3): fetched with
 * no cookies, HTML reduced to its text, and capped, so a page reaches the
 * agent as plain words. The caller snapshots it and marks it untrusted.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARS = 60_000;

export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export async function readLink(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string } | { error: string }> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: "follow",
      credentials: "omit",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { error: `Couldn't reach ${url}.` };
  }
  if (!res.ok) return { error: `${url} answered ${String(res.status)}.` };
  const type = res.headers.get("content-type") ?? "";
  if (!/text|json|xml|markdown/i.test(type) && type !== "")
    return { error: `${url} isn't a page of text (${type}).` };
  const body = await res.arrayBuffer();
  const raw = new TextDecoder().decode(body.slice(0, MAX_BYTES));
  const text = /html/i.test(type) ? pageText(raw) : raw;
  return { text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(cut here)` : text };
}
