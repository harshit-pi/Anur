import { describe, expect, it } from "vitest";
import { isChannel } from "../shared/ipc-contract.ts";
import { IpcRefused, guarded, trustedSenders } from "./ipc.ts";

const PAGE = "file:///Applications/Anur.app/Contents/Resources/app/out/renderer/index.html";
const info = { name: "Anur", version: "0.0.0", formatVersion: 1, platform: "darwin" as const };

function setup() {
  const senders = trustedSenders(() => PAGE);
  senders.add(7);
  const run = guarded(
    "app:info",
    () => info,
    (s) => senders.isTrusted(s),
  );
  return { senders, run };
}

describe("IPC from the renderer", () => {
  it("answers our own window's page with a checked response", async () => {
    const { run } = setup();
    await expect(run({ webContentsId: 7, frameUrl: PAGE }, {})).resolves.toEqual(info);
  });

  it("refuses another window, another page, or a frame with no URL", async () => {
    const { run } = setup();
    await expect(run({ webContentsId: 8, frameUrl: PAGE }, {})).rejects.toBeInstanceOf(IpcRefused);
    await expect(
      run({ webContentsId: 7, frameUrl: "https://evil.example/index.html" }, {}),
    ).rejects.toBeInstanceOf(IpcRefused);
    await expect(
      run({ webContentsId: 7, frameUrl: "file:///tmp/other.html" }, {}),
    ).rejects.toBeInstanceOf(IpcRefused);
    await expect(run({ webContentsId: 7, frameUrl: null }, {})).rejects.toBeInstanceOf(IpcRefused);
  });

  it("refuses a request that doesn't match its schema", async () => {
    const { run } = setup();
    await expect(run({ webContentsId: 7, frameUrl: PAGE }, { extra: true })).rejects.toBeInstanceOf(
      IpcRefused,
    );
    await expect(run({ webContentsId: 7, frameUrl: PAGE }, "text")).rejects.toBeInstanceOf(
      IpcRefused,
    );
  });

  it("stops trusting a window once it closes", async () => {
    const { senders, run } = setup();
    senders.remove(7);
    await expect(run({ webContentsId: 7, frameUrl: PAGE }, {})).rejects.toBeInstanceOf(IpcRefused);
  });

  it("never returns a response that breaks its own schema", async () => {
    const senders = trustedSenders(() => PAGE);
    senders.add(1);
    const run = guarded(
      "app:info",
      () => ({ ...info, platform: "beos" }) as never,
      (s) => senders.isTrusted(s),
    );
    await expect(run({ webContentsId: 1, frameUrl: PAGE }, {})).rejects.toThrow();
  });

  it("knows only the channels in the contract", () => {
    expect(isChannel("app:info")).toBe(true);
    expect(isChannel("fs:read")).toBe(false);
    expect(isChannel("__proto__")).toBe(false);
  });

  it("trusts the dev server's page in development, by origin and path", () => {
    const senders = trustedSenders(() => "http://localhost:5173/");
    senders.add(3);
    expect(senders.isTrusted({ webContentsId: 3, frameUrl: "http://localhost:5173/" })).toBe(true);
    expect(senders.isTrusted({ webContentsId: 3, frameUrl: "http://localhost:5174/" })).toBe(false);
  });
});
