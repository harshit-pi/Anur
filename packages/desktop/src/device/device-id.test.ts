import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { anurPaths } from "@anur/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hardwareHash, loadDeviceId } from "./device-id.ts";

let appSupport: string;
beforeEach(() => {
  appSupport = path.join(mkdtempSync(path.join(tmpdir(), "anur-device-")), "Anur");
});
afterEach(() => {
  rmSync(path.dirname(appSupport), { recursive: true, force: true });
});

describe("the device ID", () => {
  it("is made once and kept", async () => {
    const first = await loadDeviceId(appSupport);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(await loadDeviceId(appSupport)).toBe(first);
  });

  it("is safe to use in .anur/ file names", async () => {
    const id = await loadDeviceId(appSupport);
    expect(anurPaths.thread("d1", "t1", id)).toBe(`docs/d1/threads/t1/${id}.jsonl`);
  });

  it("is one ID when several processes start at once", async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, () => loadDeviceId(appSupport)));
    expect(new Set(ids).size).toBe(1);
    expect(readdirSync(appSupport)).toEqual(["device.json"]);
  });

  it("is readable only by this account", async () => {
    await loadDeviceId(appSupport);
    expect(statSync(path.join(appSupport, "device.json")).mode & 0o777).toBe(0o600);
  });

  it("differs between installs", async () => {
    const other = path.join(path.dirname(appSupport), "Other");
    expect(await loadDeviceId(appSupport)).not.toBe(await loadDeviceId(other));
  });

  it("refuses to replace an unreadable file silently", async () => {
    await loadDeviceId(appSupport);
    writeFileSync(path.join(appSupport, "device.json"), "garbage");
    await expect(loadDeviceId(appSupport)).rejects.toThrow(/can't be read/);
  });

  it("stays on the same Mac, and learns it when the file is from before the check", async () => {
    const mac = () => Promise.resolve("mac-a");
    const first = await loadDeviceId(appSupport, Date.now, () => Promise.resolve(null));
    expect(await loadDeviceId(appSupport, Date.now, mac)).toBe(first);
    const saved = JSON.parse(readFileSync(path.join(appSupport, "device.json"), "utf8")) as {
      machine?: string;
    };
    expect(saved.machine).toBe("mac-a");
    expect(await loadDeviceId(appSupport, Date.now, mac)).toBe(first);
  });

  it("is made new when the file came from another Mac", async () => {
    const first = await loadDeviceId(appSupport, Date.now, () => Promise.resolve("mac-a"));
    const moved = await loadDeviceId(appSupport, Date.now, () => Promise.resolve("mac-b"));
    expect(moved).not.toBe(first);
    expect(moved).toMatch(/^[0-9a-f]{32}$/);
    // And then it's that Mac's own.
    expect(await loadDeviceId(appSupport, Date.now, () => Promise.resolve("mac-b"))).toBe(moved);
  });

  it("reads this Mac as a hash, never the hardware ID itself", async () => {
    const hash = await hardwareHash();
    if (process.platform === "darwin") expect(hash).toMatch(/^[0-9a-f]{32}$/);
    else expect(hash).toBe(null);
  });
});
