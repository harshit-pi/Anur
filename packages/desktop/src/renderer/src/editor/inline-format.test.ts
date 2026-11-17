import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { flipStyle, type Style } from "./inline-format.ts";
import { markdownSupport } from "./sections.ts";

/** Flip `style` on the text between "[" and "]" in `marked`; the brackets aren't part of the doc. */
function flip(marked: string, style: Style = "bold") {
  const from = marked.indexOf("[");
  const to = marked.indexOf("]") - 1;
  const doc = marked.replace("[", "").replace("]", "");
  return flipAt(doc, from, to, style);
}

function flipAt(doc: string, from: number, to: number, style: Style = "bold") {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(from, to),
    extensions: [markdownSupport()],
  });
  return state.update({ changes: flipStyle(state, style) }).state.doc.toString();
}

describe("bold, as a doc editor does it", () => {
  it("bolds and unbolds a whole run", () => {
    expect(flip("see [which named readers] now")).toBe("see **which named readers** now");
    expect(flip("see **[which named readers]** now")).toBe("see which named readers now");
  });

  it("unbolds however the selection meets the hidden marks", () => {
    const doc = "see **which named readers** now";
    const inner = [doc.indexOf("which"), doc.indexOf("** now")] as const;
    const want = "see which named readers now";
    expect(flipAt(doc, inner[0], inner[1])).toBe(want);
    expect(flipAt(doc, inner[0], inner[1] + 2)).toBe(want);
    expect(flipAt(doc, inner[0] - 2, inner[1])).toBe(want);
    expect(flipAt(doc, inner[0] - 2, inner[1] + 2)).toBe(want);
  });

  it("unbolds one word in the middle, leaving the words around it bold", () => {
    expect(flip("see **which [named] readers** now")).toBe("see **which** named **readers** now");
  });

  it("unbolds the start or the end of a run", () => {
    expect(flip("**[which named] readers**")).toBe("which named **readers**");
    expect(flip("**which [named readers]**")).toBe("**which** named readers");
  });

  it("bolds a mix of bold and plain all the way, merging runs", () => {
    expect(flip("[**a** b **c**]")).toBe("**a b c**");
    expect(flip("**a [b** c] d")).toBe("**a b c** d");
  });

  it("keeps italic when bold comes off, and bold when italic does", () => {
    expect(flip("***[x]***")).toBe("*x*");
    expect(flip("**a *[b]* c**")).toBe("**a** *b* **c**");
    expect(flip("**a *[b]* c**", "italic")).toBe("**a b c**");
  });

  it("never leaves a mark beside a space", () => {
    expect(flip("see[ which ]now")).toBe("see **which** now");
    expect(flip("**a[ b] c**")).toBe("**a** b **c**");
  });

  it("keeps links, code and wiki links whole", () => {
    // A selection that starts before the link and ends inside its text takes the whole link.
    const doc = "see the [tracker](https://x.com) now";
    expect(flipAt(doc, doc.indexOf("the"), doc.indexOf("cker"))).toBe(
      "see **the [tracker](https://x.com)** now",
    );
    expect(flip("run `[ls] -la` here")).toBe("run **`ls -la`** here");
    expect(flip("see [[[Pers]onas]] now")).toBe("see **[[Personas]]** now");
  });

  it("formats each line of a selection on its own", () => {
    expect(flip("[one\ntwo]")).toBe("**one**\n**two**");
  });

  it("reads underscores as bold and italic too", () => {
    expect(flip("__[bold]__")).toBe("bold");
    expect(flip("_[it]_", "italic")).toBe("it");
  });

  it("strikes through like the others", () => {
    expect(flip("a [b] c", "strike")).toBe("a ~~b~~ c");
    expect(flip("~~a [b] c~~", "strike")).toBe("~~a~~ b ~~c~~");
  });

  it("changes nothing outside the line it touches", () => {
    const doc = "# Title\n\n__kept__ and *[this]*\n\nAnother **para**.";
    expect(
      flip(doc)
        .split("\n")
        .filter((l, i) => l !== doc.replace("[", "").replace("]", "").split("\n")[i]),
    ).toEqual(["__kept__ and ***this***"]);
  });
});
