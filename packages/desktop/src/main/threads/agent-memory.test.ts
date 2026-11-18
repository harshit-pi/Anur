import { describe, expect, it } from "vitest";
import { treeRssKb } from "./agent-memory.ts";

describe("the agents' memory", () => {
  it("adds up the host and everything under it, nothing else", () => {
    const ps = [
      "  1     0   9000",
      " 100    1   2048", // the host
      " 101  100  10240", // an agent
      " 102  101  51200", // a session under it
      " 103  102   1024", // its tool
      " 200    1  99999", // something else
      "garbage",
    ].join("\n");
    expect(treeRssKb(ps, 100)).toBe(2048 + 10240 + 51200 + 1024);
    expect(treeRssKb(ps, 999)).toBe(0);
  });
});
