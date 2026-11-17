import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * The page's look, from brand/tokens.css: Charter for decided text, the
 * Markdown marks quiet so the words lead, one readable column.
 */
export const pageTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--sheet)", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-doc)", fontSize: "17px", lineHeight: "1.6" },
  ".cm-content": {
    maxWidth: "var(--page-width)",
    margin: "0 auto",
    padding: "40px 32px 120px",
    caretColor: "var(--blue)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--blue)" },
  // The insert menu ("/") and "[[" links: a quiet list in the UI face.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid var(--rule)",
    borderRadius: "8px",
    backgroundColor: "var(--sheet)",
    boxShadow: "var(--shadow)",
    padding: "4px",
    overflow: "hidden",
  },
  // As specific as CodeMirror's own rule, which sets a monospace face.
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-ui)",
    fontSize: "13px",
    maxHeight: "18em",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "baseline",
    gap: "12px",
    padding: "5px 10px !important",
    borderRadius: "5px",
    color: "var(--ink)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--blue-wash)",
    color: "var(--ink)",
  },
  ".cm-completionDetail": {
    marginLeft: "auto",
    fontStyle: "normal",
    color: "var(--graphite)",
  },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "650" },
  // A link's address, in a pop-up under the link (2.11).
  ".cm-tooltip.cm-lp-link-editor": {
    border: "1px solid var(--rule)",
    borderRadius: "8px",
    backgroundColor: "var(--sheet)",
    boxShadow: "var(--shadow)",
    padding: "6px",
  },
  ".cm-lp-link-editor input": {
    width: "320px",
    font: "13px var(--font-ui)",
    color: "var(--ink)",
    background: "var(--paper)",
    border: "1px solid var(--rule)",
    borderRadius: "5px",
    padding: "5px 8px",
    outline: "none",
  },
  ".cm-lp-link-editor input:focus": { borderColor: "var(--blue)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--blue-wash) !important",
  },
});

export const pageHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading1, fontSize: "30px", fontWeight: "700", lineHeight: "1.3" },
    { tag: t.heading2, fontSize: "23px", fontWeight: "700", lineHeight: "1.35" },
    { tag: t.heading3, fontSize: "19px", fontWeight: "650" },
    { tag: [t.heading4, t.heading5, t.heading6], fontSize: "17px", fontWeight: "650" },
    { tag: t.processingInstruction, color: "var(--pencil)" },
    { tag: t.meta, color: "var(--graphite)" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.strikethrough, textDecoration: "line-through", color: "var(--graphite)" },
    { tag: [t.link, t.url], color: "var(--blue)" },
    { tag: t.labelName, color: "var(--blue)" },
    { tag: t.quote, color: "var(--ink2)" },
    {
      tag: t.monospace,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: "14.5px",
    },
    { tag: t.contentSeparator, color: "var(--pencil)" },
  ]),
);
