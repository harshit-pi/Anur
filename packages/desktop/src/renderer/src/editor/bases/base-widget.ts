import { Facet } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";
import type { Response } from "../../../../shared/ipc-contract.ts";
import { followLinkIn } from "../link-click.ts";
import { anur } from "../../bridge.ts";

/**
 * An embedded Obsidian base, `![[Ideas.base]]`, drawn as its table: a tab
 * per view, the notes each view keeps, a click on a name opening the note.
 * Read-only, as the file is; it reloads when the window comes back to the
 * front, so edits made elsewhere show.
 */

/** The page's own path, for finding the embed's file nearest it. */
export const pagePath = Facet.define<string, string>({
  combine: (values) => values[0] ?? "",
});

type Read = Response<"base:read">;
type Ready = Extract<Read, { kind: "base" }>;

/** The view picked for each embed, kept while Anur runs. */
const picked = new Map<string, string>();

/** Each drawn table's reload, to stop listening when it goes. */
const reloads = new WeakMap<HTMLElement, () => void>();

export class BaseWidget extends WidgetType {
  constructor(readonly target: string) {
    super();
  }
  override eq(other: BaseWidget) {
    return other.target === this.target;
  }
  override get estimatedHeight() {
    return 240;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-base";
    wrap.contentEditable = "false";
    wrap.textContent = `Reading ${this.target}…`;
    wrap.addEventListener("mousedown", (e) => {
      followLinkIn(view, e, null);
    });
    const key = `${view.state.facet(pagePath)}\0${this.target}`;
    const load = () => {
      void anur
        .call("base:read", { target: this.target, from: view.state.facet(pagePath) })
        .then((read) => {
          draw(wrap, read, key);
          view.requestMeasure();
        });
    };
    reloads.set(wrap, load);
    window.addEventListener("focus", load);
    load();
    return wrap;
  }

  override destroy(dom: HTMLElement) {
    const load = reloads.get(dom);
    if (load) window.removeEventListener("focus", load);
  }

  override ignoreEvent() {
    return true;
  }
}

function draw(wrap: HTMLElement, read: Read, key: string) {
  wrap.replaceChildren();
  if (read.kind === "failed") {
    wrap.append(note(read.reason));
    return;
  }
  if (read.views.length === 0) {
    wrap.append(note(read.problems[0] ?? "This base has no views."));
    return;
  }
  const named = read.view ? read.views.find((v) => v.name === read.view) : undefined;
  const chosen = () => named ?? read.views.find((v) => v.name === picked.get(key)) ?? read.views[0];
  const head = document.createElement("div");
  head.className = "cm-lp-base-head";
  const title = document.createElement("span");
  title.className = "cm-lp-base-title";
  title.textContent = (read.path.split("/").pop() ?? read.path).replace(/\.base$/, "");
  head.append(title);
  const body = document.createElement("div");
  const render = () => {
    const v = chosen();
    for (const tab of head.querySelectorAll<HTMLButtonElement>(".cm-lp-base-tab")) {
      tab.setAttribute("aria-selected", String(tab.textContent === v?.name));
    }
    body.replaceChildren(v ? table(v) : note("Nothing to show."));
    if (v) body.append(footer(read, v));
  };
  // Tabs only when the embed doesn't name its view.
  if (!named) {
    for (const v of read.views) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "cm-lp-base-tab";
      tab.textContent = v.name;
      tab.addEventListener("click", () => {
        picked.set(key, v.name);
        render();
      });
      head.append(tab);
    }
  }
  wrap.append(head, body);
  render();
}

function table(v: Ready["views"][number]) {
  const scroll = document.createElement("div");
  scroll.className = "cm-lp-table-wrap cm-lp-base-scroll";
  const t = document.createElement("table");
  t.className = "cm-lp-table cm-lp-base-table";
  const hr = document.createElement("tr");
  for (const c of v.columns) {
    const th = document.createElement("th");
    th.textContent = c.label;
    hr.append(th);
  }
  t.append(hr);
  for (const row of v.rows) {
    const tr = document.createElement("tr");
    for (const cell of row.cells) {
      const td = document.createElement("td");
      // Long text shows three lines; the rest on hover.
      const box = document.createElement("div");
      box.className = "cm-lp-base-cell";
      if (cell.text.length > 80) box.title = cell.text;
      if (cell.link !== null && cell.text !== "") {
        const a = document.createElement("span");
        a.className = "cm-lp-link";
        a.dataset.wikiTarget = cell.link;
        a.textContent = cell.text;
        box.append(a);
      } else box.textContent = cell.text;
      td.append(box);
      tr.append(td);
    }
    t.append(tr);
  }
  scroll.append(t);
  return scroll;
}

function footer(read: Ready, v: Ready["views"][number]) {
  const lines = [`${String(v.rows.length)} ${v.rows.length === 1 ? "note" : "notes"}`];
  if (read.skipped > 0)
    lines.push(`${String(read.skipped)} not downloaded from iCloud yet, left out`);
  const f = note(lines.join(" · "));
  for (const p of read.problems) f.append(document.createElement("br"), p);
  return f;
}

function note(text: string) {
  const p = document.createElement("div");
  p.className = "cm-lp-base-note";
  p.textContent = text;
  return p;
}
