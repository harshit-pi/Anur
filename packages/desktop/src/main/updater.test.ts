import { describe, expect, it, vi } from "vitest";

vi.mock("electron-updater", () => ({ default: { autoUpdater: {} } }));
const { reasonOf } = await import("./updater.ts");

describe("update errors", () => {
  it("say no connection when the Mac is offline, else blame the server", () => {
    expect(reasonOf(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe("no connection");
    expect(reasonOf(new Error("getaddrinfo ENOTFOUND do7t8q39ulre5.cloudfront.net"))).toBe(
      "no connection",
    );
    expect(reasonOf(new Error("HttpError: 403 Forbidden"))).toBe("the update server didn't answer");
  });
});
