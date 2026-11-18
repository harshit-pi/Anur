import type { KnownThreadLine } from "@anur/core";
import { describe, expect, it } from "vitest";
import { tokensOf } from "./threads.ts";

const end = (
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | null,
) =>
  ({
    id: "x",
    at: "2026-11-17T00:00:00.000Z",
    dev: "d",
    seq: 0,
    kind: "turn",
    turn: "u1",
    event: "end",
    agent: null,
    adapter: null,
    model: null,
    stopReason: "end_turn",
    usage,
  }) as KnownThreadLine;

describe("a thread's tokens", () => {
  it("adds every turn's usage, and keeps the last turn's context", () => {
    const lines = [
      end({ input: 4, output: 668, cacheRead: 66_786, cacheWrite: 28_515 }),
      end({ input: 6, output: 1_365, cacheRead: 118_794, cacheWrite: 31_291 }),
    ];
    expect(tokensOf(lines)).toEqual({
      used: 4 + 668 + 66_786 + 28_515 + 6 + 1_365 + 118_794 + 31_291,
      context: 6 + 1_365 + 118_794 + 31_291,
      first: 4 + 668 + 66_786 + 28_515,
      window: null,
    });
  });

  it("takes the context and window from the agent's own report when it gave one", () => {
    const withContext = {
      ...end({ input: 6, output: 1_365, cacheRead: 118_794, cacheWrite: 31_291 }),
      context: { used: 150_000, size: 200_000 },
    } as KnownThreadLine;
    expect(tokensOf([withContext])).toMatchObject({ context: 150_000, window: 200_000 });
  });

  it("is unknown until the agent reports usage", () => {
    expect(tokensOf([end(null)])).toBeNull();
  });
});
