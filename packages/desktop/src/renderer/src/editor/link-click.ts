import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * Following links from the page (task 2.22). A click on a link opens it, and
 * ⌘-click opens it in a new tab, instead of putting the cursor there; to
 * edit a link, the cursor arrives by keyboard, and its pop-up (2.11) holds
 * the address.
 */

export type ClickedLink =
  { kind: "wiki"; target: string; heading: string | null } | { kind: "href"; href: string };

/** The link at `pos`, as written, or null. */
export function linkAt(state: EditorState, pos: number): ClickedLink | null {
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
      if (n.name === "WikiLink") {
        const target = n.getChild("WikiLinkTarget");
        const heading = n.getChild("WikiLinkHeading");
        return {
          kind: "wiki",
          target: target ? state.sliceDoc(target.from, target.to) : "",
          heading: heading ? state.sliceDoc(heading.from, heading.to) : null,
        };
      }
      if (n.name === "Link") {
        const url = n.getChild("URL");
        return url ? { kind: "href", href: state.sliceDoc(url.from, url.to) } : null;
      }
    }
  }
  return null;
}

type Open = (link: ClickedLink, inNewTab: boolean) => void;

/** How this page follows a link, for widgets such as tables to use. */
export const linkOpener = Facet.define<Open, Open | null>({
  combine: (values) => values[0] ?? null,
});

/** A link drawn inside a widget, such as a table cell, from the data it carries. */
export function linkFromElement(el: HTMLElement): ClickedLink | null {
  if (el.dataset.wikiTarget !== undefined) {
    return { kind: "wiki", target: el.dataset.wikiTarget, heading: el.dataset.wikiHeading ?? null };
  }
  if (el.dataset.href !== undefined) return { kind: "href", href: el.dataset.href };
  return null;
}

/**
 * In a widget whose text is typed into, such as a table cell: a press on a
 * link follows it unless that text is being edited. True when it did.
 */
export function followLinkIn(
  view: EditorView,
  e: MouseEvent,
  editing: HTMLElement | null,
): boolean {
  if (e.button !== 0 || e.shiftKey || e.altKey) return false;
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(".cm-lp-link");
  if (!el || (editing && editing.contains(el) && editing === document.activeElement)) return false;
  const link = linkFromElement(el);
  const open = view.state.facet(linkOpener);
  if (!link || !open) return false;
  e.preventDefault();
  e.stopPropagation();
  open(link, e.metaKey || e.ctrlKey);
  return true;
}

export function linkClicks(open: Open): Extension {
  return [linkOpener.of(open), clickHandler(open)];
}

function clickHandler(open: Open): Extension {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0 || e.shiftKey || e.altKey) return false;
      const el = (e.target as HTMLElement | null)?.closest(".cm-lp-link");
      if (!el || !view.contentDOM.contains(el)) return false;
      const link = linkAt(view.state, view.posAtDOM(el));
      if (!link) return false;
      e.preventDefault();
      open(link, e.metaKey || e.ctrlKey);
      return true;
    },
  });
}
