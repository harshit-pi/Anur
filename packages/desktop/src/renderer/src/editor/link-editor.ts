import { syntaxTree } from "@codemirror/language";
import { type EditorState, StateField } from "@codemirror/state";
import { type Command, type EditorView, type Tooltip, showTooltip } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * A link's address, edited in a pop-up (task 2.11). Links show only their
 * text on the page; with the cursor in one, a small pop-up under it holds
 * the address (or, for a wiki link, the doc and heading it points to).
 * Enter writes it into the Markdown; Escape goes back to the text.
 */

type Target = {
  kind: "link" | "wiki";
  /** Where the link starts, which finds it again at edit time. */
  from: number;
  /** The address's range, or where it goes when there is none yet. */
  value: { from: number; to: number };
};

function linkAround(state: EditorState, pos: number): SyntaxNode | null {
  for (const side of [-1, 1] as const) {
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
      if (n.name === "Link" || n.name === "WikiLink") return n;
    }
  }
  return null;
}

/** The link the cursor is in and where its address sits, or null. */
export function linkTarget(state: EditorState, pos: number): Target | null {
  const link = linkAround(state, pos);
  if (!link) return null;
  const kids: SyntaxNode[] = [];
  for (let c = link.firstChild; c; c = c.nextSibling) kids.push(c);
  if (link.name === "Link") {
    const url = kids.find((k) => k.name === "URL");
    if (url) return { kind: "link", from: link.from, value: { from: url.from, to: url.to } };
    const marks = kids.filter((k) => k.name === "LinkMark");
    const paren = marks[2];
    if (!paren) return null;
    return { kind: "link", from: link.from, value: { from: paren.to, to: paren.to } };
  }
  const target = kids.find((k) => k.name === "WikiLinkTarget");
  const heading = kids.find((k) => k.name === "WikiLinkHeading");
  const start = (target ?? heading)?.from ?? link.from + 2;
  const end = (heading ?? target)?.to ?? start;
  return { kind: "wiki", from: link.from, value: { from: start, to: end } };
}

function editorDOM(view: EditorView, target: Target): HTMLElement {
  const box = document.createElement("div");
  box.className = "cm-lp-link-editor";
  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.placeholder = target.kind === "link" ? "Paste or type an address" : "Doc, or Doc#Heading";
  input.setAttribute("aria-label", target.kind === "link" ? "Link address" : "Linked doc");
  input.value = view.state.sliceDoc(target.value.from, target.value.to);
  const write = () => {
    const now = linkTarget(view.state, target.from + 1);
    if (!now) return;
    const current = view.state.sliceDoc(now.value.from, now.value.to);
    const next = input.value.trim().replace(/\s/g, now.kind === "link" ? "%20" : " ");
    if (next === current) return;
    view.dispatch({
      changes: { from: now.value.from, to: now.value.to, insert: next },
      userEvent: "input.link",
    });
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      write();
      view.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.value = view.state.sliceDoc(target.value.from, target.value.to);
      view.focus();
    }
  });
  input.addEventListener("blur", write);
  box.append(input);
  // A new link has no address yet: the pop-up takes the cursor at once.
  if (input.value === "") {
    requestAnimationFrame(() => {
      input.focus();
    });
  }
  return box;
}

const linkTooltip = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    const sel = tr.state.selection.main;
    const target = linkTarget(tr.state, sel.head);
    if (!target || (!sel.empty && linkTarget(tr.state, sel.anchor)?.from !== target.from)) {
      return null;
    }
    if (value && value.pos === target.from && !tr.docChanged) return value;
    return {
      pos: target.from,
      above: false,
      create: (view) => ({ dom: editorDOM(view, target) }),
    };
  },
  provide: (f) => showTooltip.from(f),
});

/** ⌘K inside a link: move to its address. */
export const editLink: Command = (view) => {
  if (!linkTarget(view.state, view.state.selection.main.head)) return false;
  const input = view.dom.querySelector<HTMLInputElement>(".cm-lp-link-editor input");
  if (!input) return false;
  input.focus();
  input.select();
  return true;
};

export const linkEditor = [linkTooltip];
