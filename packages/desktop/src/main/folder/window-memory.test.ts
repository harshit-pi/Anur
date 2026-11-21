import { describe, expect, it } from "vitest";
import type { OpenWindow } from "./open-windows.ts";
import { windowMemory } from "./window-memory.ts";

const w = (folder: string): OpenWindow => ({ folder, bounds: null });

describe("remembering the open windows", () => {
  it("remembers them as a plain quit starts", async () => {
    const saved: OpenWindow[][] = [];
    const m = windowMemory((open) => {
      saved.push(open);
      return Promise.resolve();
    });
    await m.atQuit([w("/a"), w("/b")]);
    expect(saved).toEqual([[w("/a"), w("/b")]]);
  });

  it("keeps what a restart to update remembered, not the none left when its quit starts", async () => {
    const saved: OpenWindow[][] = [];
    const m = windowMemory((open) => {
      saved.push(open);
      return Promise.resolve();
    });
    await m.beforeRestart([w("/a"), w("/b")]);
    // The updater has closed every window by the time the quit starts.
    expect(m.atQuit([])).toBeNull();
    expect(saved).toEqual([[w("/a"), w("/b")]]);
  });
});
