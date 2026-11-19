import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { openAnurFolder } from "../../vault/anur-folder.ts";
import { Plugins } from "./plugins.ts";

const temp = (p: string) => mkdtempSync(path.join(tmpdir(), p));

/** A signed feed offering one plugin, "echo", whose status says what its setting is. */
function feedWithEcho() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const dir = temp("anur-feed-echo-");
  const body = `export function activate(ctx) {
  const say = () => ctx.status({ text: "speed " + ctx.setting("speed") });
  say();
  return { settingsChanged: say, stop: () => ctx.status(null) };
}\n`;
  writeFileSync(path.join(dir, "echo-1.0.0.mjs"), body);
  const index = Buffer.from(
    JSON.stringify({
      plugins: [
        {
          id: "echo",
          name: "Echo",
          what: "Says its setting.",
          version: "1.0.0",
          apiVersion: 1,
          kind: "standard",
          file: "echo-1.0.0.mjs",
          sha256: createHash("sha256").update(body).digest("hex"),
          settings: [
            {
              type: "choice",
              key: "speed",
              label: "Speed",
              choices: [
                { value: "slow", label: "Slow" },
                { value: "fast", label: "Fast" },
              ],
              default: "slow",
            },
          ],
        },
      ],
    }),
  );
  writeFileSync(path.join(dir, "index.json"), index);
  writeFileSync(path.join(dir, "index.json.sig"), sign(null, index, privateKey).toString("base64"));
  return {
    feed: pathToFileURL(dir).href,
    key: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

function plugins(feed: { feed: string; key: string }) {
  const said: string[] = [];
  const statuses: (string | null)[] = [];
  const p = new Plugins({
    dir: temp("anur-plugins-home-"),
    openFolders: () => [],
    person: () => Promise.resolve({ name: "Sam", handle: "sam" }),
    path: () => Promise.resolve(process.env.PATH ?? ""),
    status: (_f, _id, s) => statuses.push(s?.text ?? null),
    notify: (_f, text) => said.push(text),
    filesChanged: () => undefined,
    autoUpdate: () => true,
    feed: feed.feed,
    key: feed.key,
  });
  return { p, said, statuses };
}

describe("a folder's plugins live in the folder", () => {
  it("keeps what's on and each setting in .anur/plugins/, committed with the folder", async () => {
    const feed = feedWithEcho();
    const folder = temp("anur-plug-folder-");
    execFileSync("git", ["-C", folder, "init", "-q"]);
    await openAnurFolder(folder);
    const { p, statuses } = plugins(feed);
    await p.install("echo", folder);
    expect(statuses.at(-1)).toBe("speed slow");
    await p.setValue(folder, "echo", "speed", "fast");
    expect(statuses.at(-1)).toBe("speed fast");
    expect(
      JSON.parse(readFileSync(path.join(folder, ".anur/plugins/enabled.json"), "utf8")),
    ).toEqual({ on: ["echo"] });
    expect(JSON.parse(readFileSync(path.join(folder, ".anur/plugins/echo.json"), "utf8"))).toEqual({
      speed: "fast",
    });
    const ignored = (f: string) => {
      try {
        execFileSync("git", ["-C", folder, "check-ignore", "-q", f]);
        return true;
      } catch {
        return false;
      }
    };
    expect(ignored(".anur/plugins/echo.json")).toBe(false);
    expect(ignored(".anur/plugins/enabled.json")).toBe(false);
    // Kept on this Mac: out of git, the folder's other lines kept; and back again.
    await p.setKeptOnMac(folder, "echo", true);
    expect(await p.keptOnMac(folder, "echo")).toBe(true);
    expect(ignored(".anur/plugins/echo.json")).toBe(true);
    expect(ignored(".anur/plugins/enabled.json")).toBe(false);
    expect(readFileSync(path.join(folder, ".anur/.gitignore"), "utf8")).toContain(
      "system/last-read.json",
    );
    await p.setKeptOnMac(folder, "echo", false);
    expect(ignored(".anur/plugins/echo.json")).toBe(false);
  });

  it("installs and starts the plugins a teammate's folder has on, with their settings", async () => {
    const feed = feedWithEcho();
    const folder = temp("anur-plug-teammate-");
    mkdirSync(path.join(folder, ".anur/plugins"), { recursive: true });
    writeFileSync(path.join(folder, ".anur/plugins/enabled.json"), '{"on":["echo"]}\n');
    writeFileSync(path.join(folder, ".anur/plugins/echo.json"), '{"speed":"fast"}\n');
    const { p, said, statuses } = plugins(feed);
    expect(Object.keys(await p.installed())).toEqual([]);
    await p.startFolder(folder);
    expect(Object.keys(await p.installed())).toEqual(["echo"]);
    expect(said).toEqual(["Installed Echo, which this folder uses."]);
    expect(statuses.at(-1)).toBe("speed fast");
    // A pull changes the setting, then switches it off: the plugin follows.
    writeFileSync(path.join(folder, ".anur/plugins/echo.json"), '{"speed":"slow"}\n');
    await p.reloadFolder(folder);
    expect(statuses.at(-1)).toBe("speed slow");
    writeFileSync(path.join(folder, ".anur/plugins/enabled.json"), '{"on":[]}\n');
    await p.reloadFolder(folder);
    expect(statuses.at(-1)).toBe(null);
  });
});
