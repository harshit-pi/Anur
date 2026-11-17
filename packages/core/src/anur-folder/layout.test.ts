import { describe, expect, it } from "vitest";
import { FORMAT_VERSION } from "../format.ts";
import { accessFor, anurPaths, formatFileText } from "./layout.ts";

describe("the .anur/ layout", () => {
  it("puts the writing device in every file that changes often", () => {
    expect(anurPaths.open("dev1")).toBe("open/dev1.json");
    expect(anurPaths.settings("dev1")).toBe("settings/dev1.json");
    expect(anurPaths.deletedSnapshots("dev1")).toBe("snapshots/deleted/dev1.jsonl");
    expect(anurPaths.ids("d1", "dev1")).toBe("docs/d1/ids/dev1.jsonl");
    expect(anurPaths.layout("d1", "dev1")).toBe("docs/d1/layout/dev1.json");
    expect(anurPaths.thread("d1", "t1", "dev1")).toBe("docs/d1/threads/t1/dev1.jsonl");
    expect(anurPaths.inputs("d1", "dev1")).toBe("docs/d1/inputs/dev1.jsonl");
    expect(anurPaths.preview("d1", "dev1", "p1")).toBe("docs/d1/previews/dev1/p1.json");
    expect(anurPaths.history("d1", "s1", "dev1")).toBe("docs/d1/history/s1/dev1.jsonl");
    expect(anurPaths.snapshot("ab12cd")).toBe("snapshots/ab12cd");
  });

  it.each(["", "..", ".", "a/b", "a\\b", ".hidden", "-flag", "a b", "é", "x".repeat(129)])(
    "refuses %j as a name, so nothing climbs out of .anur/",
    (bad) => {
      expect(() => anurPaths.thread("d1", bad, "dev1")).toThrow(/unsafe/);
      expect(() => anurPaths.ids(bad, "dev1")).toThrow(/unsafe/);
    },
  );
});

describe("format.json", () => {
  it("is written with the current format number", () => {
    expect(JSON.parse(formatFileText())).toEqual({ format: FORMAT_VERSION });
  });

  it("opens a folder of this format or older for writing, keeping unknown fields fine", () => {
    expect(accessFor('{"format":1}')).toEqual({ mode: "writable", format: 1 });
    expect(accessFor('{"format":1,"addedLater":true}').mode).toBe("writable");
  });

  it("opens a newer folder read-only, saying why", () => {
    const access = accessFor(JSON.stringify({ format: FORMAT_VERSION + 1 }));
    expect(access.mode).toBe("read-only");
    expect(access.mode === "read-only" && access.reason).toMatch(/Update Anur/);
  });

  it.each(["not json", "{}", '{"format":"1"}', '{"format":0}', "[]"])(
    "opens read-only, never overwriting, when format.json is %j",
    (text) => {
      expect(accessFor(text).mode).toBe("read-only");
    },
  );
});
