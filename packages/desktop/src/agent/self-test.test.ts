import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkedIn, hookSaw } from "./check-log.ts";
import { selfTest } from "./self-test.ts";

const hook = path.join(import.meta.dirname, "hook.ts");

describe("the thread check's self-test", () => {
  it("passes the real hook program", () => {
    expect(selfTest(process.execPath, {}, hook)).toBeNull();
  });

  it("fails a hook that lets everything through", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "anur-hook-"));
    const lax = path.join(dir, "lax.mjs");
    await writeFile(lax, "process.exit(0);\n");
    expect(selfTest(process.execPath, {}, lax)).toBe("the hook allowed a read of another thread");
  });
});

describe("reading the hook's log", () => {
  it("finds a session's check-in and the tool calls the hook saw", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "anur-log-"));
    const log = path.join(dir, "t.log.jsonl");
    await writeFile(
      log,
      [
        JSON.stringify({ session: "s1", event: "start" }),
        JSON.stringify({ session: "s1", event: "tool", toolUse: "toolu_1" }),
        "",
      ].join("\n"),
    );
    expect(await checkedIn(log, "s1", 100)).toBe(true);
    expect(await checkedIn(log, "s2", 100)).toBe(false);
    expect(await hookSaw(log, "toolu_1")).toBe(true);
    expect(await hookSaw(log, "toolu_2")).toBe(false);
  });
});
