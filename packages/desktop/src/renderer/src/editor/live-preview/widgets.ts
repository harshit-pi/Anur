import { WidgetType } from "@codemirror/view";
import { renderInline } from "./inline.ts";

/**
 * What live preview draws in place of Markdown source. Widgets only show the
 * text; the document underneath is unchanged, and a click puts the cursor
 * into the source so it can be read and, later, edited.
 */

/** A list's "-" drawn as a bullet. */
export class BulletWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-lp-bullet";
    s.textContent = "•";
    return s;
  }
}

/** A task's "[ ]" or "[x]" drawn as a checkbox; ticking it comes with editing (2.8). */
export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  override eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    // Inert until editing arrives: not disabled, which would grey it out.
    box.tabIndex = -1;
    box.addEventListener("click", (e) => {
      e.preventDefault();
    });
    box.className = "cm-lp-check";
    box.setAttribute("aria-label", this.checked ? "Done" : "Not done");
    return box;
  }
}

/** A callout's "[!note]" drawn as its label. */
export class CalloutLabelWidget extends WidgetType {
  constructor(readonly kind: string) {
    super();
  }
  override eq(other: CalloutLabelWidget) {
    return other.kind === this.kind;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = `cm-lp-callout-label cm-lp-callout-label-${this.kind}`;
    s.textContent = this.kind.charAt(0).toUpperCase() + this.kind.slice(1);
    return s;
  }
}

/** A separator, such as "›" between a wiki link's file and heading. */
export class TextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly cls: string,
  ) {
    super();
  }
  override eq(other: TextWidget) {
    return other.text === this.text && other.cls === this.cls;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = this.cls;
    s.textContent = this.text;
    return s;
  }
}

/** An embed, such as ![[Mock.png]], drawn as a labelled chip until embeds render. */
export class EmbedWidget extends WidgetType {
  constructor(readonly target: string) {
    super();
  }
  override eq(other: EmbedWidget) {
    return other.target === this.target;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-lp-embed";
    const image = /\.(png|jpe?g|gif|svg|webp)$/i.test(this.target);
    s.textContent = `${image ? "Image" : "Embed"}: ${this.target}`;
    return s;
  }
}

/** A table drawn as a table: header, then rows, cells rendered inline. */
export class TableWidget extends WidgetType {
  constructor(
    readonly header: string[],
    readonly rows: string[][],
    readonly align: ("left" | "center" | "right" | null)[],
  ) {
    super();
  }
  override eq(other: TableWidget) {
    return (
      JSON.stringify([other.header, other.rows, other.align]) ===
      JSON.stringify([this.header, this.rows, this.align])
    );
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-lp-table";
    const cell = (tag: "th" | "td", text: string, i: number) => {
      const c = document.createElement(tag);
      const a = this.align[i];
      if (a) c.style.textAlign = a;
      c.append(renderInline(text));
      return c;
    };
    const head = table.createTHead().insertRow();
    this.header.forEach((h, i) => {
      head.append(cell("th", h, i));
    });
    const body = table.createTBody();
    for (const row of this.rows) {
      const tr = body.insertRow();
      this.header.forEach((_, i) => {
        tr.append(cell("td", row[i] ?? "", i));
      });
    }
    wrap.append(table);
    return wrap;
  }
  override ignoreEvent() {
    return false;
  }
}

/** Frontmatter drawn as a Properties box, as Obsidian shows it. */
export class PropertiesWidget extends WidgetType {
  constructor(readonly props: [string, string[]][]) {
    super();
  }
  override eq(other: PropertiesWidget) {
    return JSON.stringify(other.props) === JSON.stringify(this.props);
  }
  toDOM() {
    const box = document.createElement("div");
    box.className = "cm-lp-properties";
    const title = document.createElement("div");
    title.className = "cm-lp-properties-title";
    title.textContent = "Properties";
    box.append(title);
    for (const [key, values] of this.props) {
      const row = document.createElement("div");
      row.className = "cm-lp-property";
      const k = document.createElement("span");
      k.className = "cm-lp-property-key";
      k.textContent = key;
      const v = document.createElement("span");
      v.className = "cm-lp-property-value";
      values.forEach((value, i) => {
        const chip = document.createElement("span");
        chip.className = values.length > 1 || key === "tags" ? "cm-lp-tag" : "";
        chip.append(renderInline(value));
        v.append(chip);
        if (i < values.length - 1 && !chip.className) v.append(document.createTextNode(", "));
      });
      row.append(k, v);
      box.append(row);
    }
    return box;
  }
  override ignoreEvent() {
    return false;
  }
}

/** A horizontal rule drawn as a line. */
export class RuleWidget extends WidgetType {
  override eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-lp-hr";
    return hr;
  }
}
