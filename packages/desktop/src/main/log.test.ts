import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { logLine, startLog } from "./log.ts";

describe("Anur's log", () => {
  it("appends each line at once, rolls past 5 MB, and drops an old roll after 14 days", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anur-log-"));
    const stale = path.join(dir, "main.old.log");
    writeFileSync(stale, "from long ago\n");
    const longAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    utimesSync(stale, longAgo, longAgo);
    const file = startLog(dir, "Anur 9.9.9 started");
    expect(existsSync(stale)).toBe(false);
    logLine("warn", "window 1", "stopped responding (%s)", "/a");
    console.error("copied from the console");
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(/^\S+Z INFO {2}\[app\] Anur 9\.9\.9 started$/m);
    expect(text).toMatch(/WARN {2}\[window 1\] stopped responding \(\/a\)$/m);
    expect(text).toMatch(/ERROR \[main\] copied from the console$/m);
    // Past 5 MB, the next line starts a fresh file and the full one is kept once.
    writeFileSync(file, "x".repeat(5 * 1024 * 1024 + 1));
    logLine("info", "app", "after the roll");
    expect(readFileSync(file, "utf8")).toMatch(/after the roll\n$/);
    expect(readFileSync(stale, "utf8").length).toBeGreaterThan(5 * 1024 * 1024);
  });
});
