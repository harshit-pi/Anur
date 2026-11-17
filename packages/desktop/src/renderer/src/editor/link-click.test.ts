import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { linkAt } from "./link-click.ts";
import { markdownSupport } from "./sections.ts";

const at = (doc: string, word: string) =>
  linkAt(EditorState.create({ doc, extensions: [markdownSupport()] }), doc.indexOf(word));

describe("the link under a click", () => {
  it("reads a wiki link's doc and heading", () => {
    expect(at("See [[Personas#Solo freelancer|the persona]] now", "the persona")).toEqual({
      kind: "wiki",
      target: "Personas",
      heading: "Solo freelancer",
    });
    expect(at("Up to [[#Scoreboard]].", "Scoreboard")).toEqual({
      kind: "wiki",
      target: "",
      heading: "Scoreboard",
    });
  });

  it("reads a Markdown link's address", () => {
    expect(at("Open [the tracker](https://x.com/t) here", "tracker")).toEqual({
      kind: "href",
      href: "https://x.com/t",
    });
  });

  it("is nothing on plain text", () => {
    expect(at("plain words", "words")).toBeNull();
  });
});
