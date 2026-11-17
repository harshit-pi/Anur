import { EditorView } from "@codemirror/view";

/** Callout kinds by colour, as Obsidian groups them; any other kind is slate. */
const CALLOUT_COLOURS: Record<string, string[]> = {
  blue: ["note", "info", "todo", "abstract", "summary", "tldr"],
  green: ["tip", "hint", "important", "success", "check", "done"],
  amber: ["warning", "caution", "attention", "question", "help", "faq"],
  red: ["danger", "error", "failure", "fail", "missing", "bug"],
};

const calloutRules: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(CALLOUT_COLOURS).flatMap(([colour, kinds]) =>
    kinds.flatMap((kind): [string, Record<string, string>][] => [
      [
        `.cm-lp-callout-${kind}`,
        { borderLeftColor: `var(--${colour})`, backgroundColor: `var(--${colour}-wash)` },
      ],
      [`.cm-lp-callout-label-${kind}`, { color: `var(--${colour})` }],
    ]),
  ),
);

/** Live preview's look, from brand/tokens.css. */
export const livePreviewTheme = EditorView.theme({
  ".cm-lp-link": {
    color: "var(--blue)",
    textDecoration: "underline",
    textDecorationColor: "var(--blue-wash)",
    textUnderlineOffset: "3px",
  },
  ".cm-lp-code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "14.5px",
    backgroundColor: "var(--hover)",
    borderRadius: "4px",
    padding: "1px 4px",
  },
  ".cm-lp-codeblock": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "14.5px",
    backgroundColor: "var(--hover)",
    padding: "0 12px !important",
  },
  ".cm-lp-bullet": { color: "var(--graphite)", display: "inline-block", width: "1.1em" },
  ".cm-lp-check": {
    margin: "0 0.45em 0 0",
    verticalAlign: "-1px",
    accentColor: "var(--blue)",
    cursor: "pointer",
    opacity: "1",
  },
  ".cm-lp-quote": {
    borderLeft: "3px solid var(--rule)",
    paddingLeft: "14px !important",
    color: "var(--ink2)",
  },
  ".cm-lp-callout": {
    borderLeft: "3px solid var(--slate)",
    backgroundColor: "var(--hover)",
    paddingLeft: "14px !important",
  },
  ".cm-lp-callout-first": { paddingTop: "6px !important", fontWeight: "650" },
  ".cm-lp-callout-label": { fontWeight: "700", marginRight: "0.4em", color: "var(--slate)" },
  ...calloutRules,
  ".cm-lp-hr": {
    display: "inline-block",
    width: "100%",
    borderTop: "1px solid var(--rule)",
    verticalAlign: "middle",
  },
  ".cm-lp-embed": {
    fontFamily: "var(--font-ui)",
    fontSize: "13px",
    color: "var(--graphite)",
    border: "1px solid var(--rule)",
    borderRadius: "6px",
    padding: "2px 8px",
  },
  ".cm-lp-table-wrap": { overflowX: "auto", margin: "8px 0" },
  ".cm-lp-table": {
    borderCollapse: "collapse",
    fontSize: "15px",
    lineHeight: "1.45",
    minWidth: "60%",
  },
  ".cm-lp-table th, .cm-lp-table td": {
    border: "1px solid var(--rule)",
    padding: "6px 10px",
    textAlign: "left",
    verticalAlign: "top",
    // The page wraps lines anywhere, even mid-word; a cell breaks only between
    // words, so a column is never squeezed narrower than its longest word.
    whiteSpace: "normal",
    wordBreak: "normal",
    overflowWrap: "normal",
  },
  ".cm-lp-table th": { fontWeight: "650", backgroundColor: "var(--hover)" },
  ".cm-lp-properties": {
    fontFamily: "var(--font-ui)",
    fontSize: "13px",
    color: "var(--ink2)",
    borderBottom: "1px solid var(--rule)",
    padding: "4px 0 12px",
    marginBottom: "8px",
  },
  ".cm-lp-properties-title": { fontWeight: "650", color: "var(--graphite)", marginBottom: "6px" },
  ".cm-lp-property": { display: "flex", gap: "12px", padding: "3px 0" },
  ".cm-lp-property-key": { flex: "0 0 140px", color: "var(--graphite)" },
  ".cm-lp-property-value": { display: "flex", flexWrap: "wrap", gap: "4px", color: "var(--ink)" },
  ".cm-lp-tag": {
    backgroundColor: "var(--blue-wash)",
    color: "var(--blue)",
    borderRadius: "10px",
    padding: "0 8px",
  },
});
