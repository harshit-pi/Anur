import { describe, expect, it } from "vitest";
import {
  addField,
  frontmatter,
  parseFields,
  removeField,
  serializeFields,
  setKey,
  setValue,
  yamlValue,
  type Properties,
} from "./properties-model.ts";

const YAML = [
  "# kept",
  'title: "Plan: v2"',
  "tags: [payments, launch]",
  "aliases:",
  "  - One",
  "  - 'Two'",
  "owner:",
  "url: https://example.com/a",
].join("\n");

const p = () => parseFields(YAML) as Properties;

describe("frontmatter as fields", () => {
  it("reads texts, lists and empty fields", () => {
    expect(p().fields.map((f) => [f.key, f.kind, f.values])).toEqual([
      ["title", "text", ["Plan: v2"]],
      ["tags", "inline-list", ["payments", "launch"]],
      ["aliases", "block-list", ["One", "Two"]],
      ["owner", "empty", []],
      ["url", "text", ["https://example.com/a"]],
    ]);
  });

  it("comes back unchanged when nothing is edited", () => {
    expect(serializeFields(p())).toBe(YAML);
  });

  it("rewrites only the field that changed", () => {
    const out = serializeFields(setValue(p(), 1, "payments, launch, q3")).split("\n");
    expect(out[2]).toBe("tags: [payments, launch, q3]");
    expect(out.filter((l, i) => l !== YAML.split("\n")[i])).toHaveLength(1);
  });

  it("keeps a block list a block list", () => {
    const out = serializeFields(setValue(p(), 2, "One, Three"));
    expect(out).toContain("aliases:\n  - One\n  - Three");
  });

  it("quotes a value only when YAML needs it", () => {
    expect(yamlValue("plain words")).toBe("plain words");
    expect(yamlValue("Plan: v2")).toBe('"Plan: v2"');
    expect(yamlValue("#hashtag")).toBe('"#hashtag"');
    expect(yamlValue("a, b", true)).toBe('"a, b"');
    expect(serializeFields(setValue(p(), 3, "Priya"))).toContain("owner: Priya");
  });

  it("renames, adds and removes fields", () => {
    expect(serializeFields(setKey(p(), 3, "lead"))).toContain("\nlead:\n");
    const added = addField(addField(p()));
    expect(added.fields.slice(-2).map((f) => f.key)).toEqual(["property", "property 2"]);
    expect(serializeFields(removeField(p(), 0))).not.toContain("title");
  });

  it("leaves YAML it can't show simply as source", () => {
    expect(parseFields("a:\n  nested: 1")).toBeNull();
    expect(parseFields("note: |\n  multi")).toBeNull();
    expect(parseFields("  indented: 1")).toBeNull();
  });

  it("writes the whole block with its fences", () => {
    expect(frontmatter(parseFields("a: 1") as Properties)).toBe("---\na: 1\n---");
    expect(frontmatter({ lead: [], fields: [] })).toBe("---\n---");
  });
});
