/**
 * A small renderer for the inline Markdown inside a widget, such as a table
 * cell or a property value: bold, italic, strikethrough, code, links and wiki
 * links. It builds DOM nodes, never HTML strings, so nothing in a doc can
 * inject markup into the page.
 */
const PATTERN =
  /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|~~(.+?)~~|`([^`]+)`|!?\[\[([^\]|]+?)(?:\\?\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g;

/** What a wiki link shows: its alias, or its heading, or its target. */
export function wikiLabel(target: string, alias: string | undefined): string {
  if (alias) return alias.trim();
  const [file, ...headings] = target.split("#");
  const parts = [file?.trim(), ...headings.map((h) => h.trim())].filter((p): p is string =>
    Boolean(p),
  );
  return parts.join(" › ");
}

export function renderInline(text: string, doc: Document = document): DocumentFragment {
  const out = doc.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(PATTERN)) {
    const at = m.index;
    if (at > last) out.append(doc.createTextNode(text.slice(last, at)));
    last = at + m[0].length;
    const el = (tag: string, cls: string | null, inner: string, nested = true) => {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (nested) node.append(renderInline(inner, doc));
      else node.textContent = inner;
      out.append(node);
      return node;
    };
    if (m[2] !== undefined) el("strong", null, m[2]);
    else if (m[4] !== undefined) el("em", null, m[4]);
    else if (m[5] !== undefined) el("s", null, m[5]);
    else if (m[6] !== undefined) el("code", "cm-lp-code", m[6], false);
    else if (m[7] !== undefined && !m[0].startsWith("!")) {
      // Where the link goes, so a click can follow it (2.22).
      const link = el("span", "cm-lp-link", wikiLabel(m[7], m[8]), false);
      const [target = "", ...heading] = m[7].split("#");
      link.dataset.wikiTarget = target.trim();
      if (heading.length) link.dataset.wikiHeading = heading.join("#").trim();
    } else if (m[7] !== undefined) el("span", "cm-lp-link", wikiLabel(m[7], m[8]), false);
    else if (m[9] !== undefined) {
      const link = el("span", "cm-lp-link", m[9]);
      if (m[10] !== undefined) link.dataset.href = m[10];
    }
  }
  if (last < text.length) out.append(doc.createTextNode(text.slice(last)));
  return out;
}
