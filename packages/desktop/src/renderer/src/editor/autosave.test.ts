import { describe, expect, it } from "vitest";
import type { Response } from "../../../shared/ipc-contract.ts";
import { Autosaver, type SaveStatus } from "./autosave.ts";

/** A manual clock and a fake disk, so every step is explicit. */
function setup(
  answer?: (text: string, base: string) => Response<"doc:save">,
  onConflict?: () => void,
) {
  let text = "a";
  let composing = false;
  const timers: (() => void)[] = [];
  const saves: { text: string; base: string }[] = [];
  const statuses: SaveStatus[] = [];
  let n = 0;
  const saver = new Autosaver("h0", {
    text: () => text,
    composing: () => composing,
    save: (t, base) => {
      saves.push({ text: t, base });
      return Promise.resolve(answer ? answer(t, base) : { kind: "saved", hash: `h${String(++n)}` });
    },
    onStatus: (s) => statuses.push(s),
    ...(onConflict ? { onConflict } : {}),
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {
      timers.length = 0;
    },
  });
  const fire = async () => {
    const pending = timers.splice(0);
    for (const t of pending) t();
    // Let the in-flight save settle.
    await new Promise((r) => setTimeout(r, 0));
  };
  return {
    saver,
    saves,
    statuses,
    fire,
    type: (t: string) => {
      text = t;
      saver.changed();
    },
    compose: (on: boolean) => {
      composing = on;
    },
    timers,
  };
}

describe("autosave", () => {
  it("saves once typing pauses, against the hash it last read", async () => {
    const s = setup();
    s.type("ab");
    s.type("abc");
    expect(s.saves).toEqual([]);
    await s.fire();
    expect(s.saves).toEqual([{ text: "abc", base: "h0" }]);
    expect(s.statuses.at(-1)).toBe("saved");
  });

  it("chains hashes from one save to the next", async () => {
    const s = setup();
    s.type("ab");
    await s.fire();
    s.type("abc");
    await s.fire();
    expect(s.saves.map((x) => x.base)).toEqual(["h0", "h1"]);
  });

  it("waits while an input method is composing", async () => {
    const s = setup();
    s.compose(true);
    s.type("にほ");
    await s.fire();
    expect(s.saves).toEqual([]);
    s.compose(false);
    await s.fire();
    expect(s.saves).toEqual([{ text: "にほ", base: "h0" }]);
  });

  it("stops and says so when the file changed outside Anur", async () => {
    const s = setup(() => ({ kind: "changed" }));
    s.type("mine");
    await s.fire();
    expect(s.statuses.at(-1)).toBe("changed-outside");
    s.type("more");
    await s.fire();
    expect(s.saves).toHaveLength(1);
  });

  it("flushes pending typing at once, as when the window closes", async () => {
    const s = setup();
    s.type("ab");
    expect(s.saver.dirty).toBe(true);
    await s.saver.flush();
    expect(s.saves).toEqual([{ text: "ab", base: "h0" }]);
    expect(s.saver.dirty).toBe(false);
  });

  it("saves nothing when the text is back to what's on disk", async () => {
    const s = setup();
    s.type("ab");
    s.type("a");
    await s.fire();
    expect(s.saves).toEqual([]);
    expect(s.statuses.at(-1)).toBe("saved");
  });
});

describe("autosave when the file changed outside Anur", () => {
  it("asks the page to rebase, saves nothing meanwhile, then saves onto the new version", async () => {
    let conflicts = 0;
    const s = setup(
      (text, base) => (base === "h-new" ? { kind: "saved", hash: "h-after" } : { kind: "changed" }),
      () => {
        conflicts++;
      },
    );
    s.type("mine");
    await s.fire();
    expect(conflicts).toBe(1);
    await s.saver.flush();
    expect(s.saves).toHaveLength(1);
    s.saver.rebase("h-new", "outside");
    await s.fire();
    expect(s.saves.at(-1)).toEqual({ text: "mine", base: "h-new" });
  });

  it("stops saving when told to, as when the doc is deleted", async () => {
    const s = setup();
    s.saver.stop("Gone.");
    s.type("more");
    await s.fire();
    expect(s.saves).toEqual([]);
    expect(s.statuses.at(-1)).toBe("failed");
  });
});
