import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { PLUGIN_KEY, PluginStore, readFeed, signedByAnur } from "./store.ts";

const temp = (p: string) => mkdtempSync(path.join(tmpdir(), p));
const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKey,
  };
};

/** A feed in a folder, signed with `key`, offering one plugin at `version`. */
function feed(
  dir: string,
  key: ReturnType<typeof keys>["privateKey"],
  version = "1.0.0",
  body = "export function activate() { return {}; }\n",
) {
  const file = `git-${version}.mjs`;
  writeFileSync(path.join(dir, file), body);
  const entry = {
    id: "git",
    name: "Git",
    what: "Sync with GitHub.",
    version,
    apiVersion: 1,
    kind: "standard",
    file,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
  const index = Buffer.from(JSON.stringify({ plugins: [entry] }));
  writeFileSync(path.join(dir, "index.json"), index);
  writeFileSync(path.join(dir, "index.json.sig"), sign(null, index, key).toString("base64"));
  return pathToFileURL(dir).href;
}

describe("plugins from Anur's feed", () => {
  it("reads a feed signed by the key, and refuses one signed by another or changed after signing", async () => {
    const ours = keys();
    const dir = temp("anur-feed-");
    const base = feed(dir, ours.privateKey);
    expect((await readFeed(base, ours.pub)).map((p) => p.id)).toEqual(["git"]);
    await expect(readFeed(base, keys().pub)).rejects.toThrow(/isn't signed by Anur/);
    writeFileSync(
      path.join(dir, "index.json"),
      readFileSync(path.join(dir, "index.json"), "utf8").replace("Sync with GitHub.", "Sync."),
    );
    await expect(readFeed(base, ours.pub)).rejects.toThrow(/isn't signed by Anur/);
  });

  it("installs a file only when its hash is the one the signed index names, and finds updates", async () => {
    const ours = keys();
    const dir = temp("anur-feed-file-");
    const base = feed(dir, ours.privateKey);
    const store = new PluginStore(temp("anur-plugins-"));
    const [git] = await readFeed(base, ours.pub);
    if (!git) throw new Error("no plugin");
    await store.install(git, base);
    expect(readFileSync(store.fileOf("git") ?? "", "utf8")).toContain("activate");
    // A file swapped after signing never installs.
    writeFileSync(path.join(dir, git.file), "export function activate() { /* not Anur's */ }\n");
    await expect(store.install(git, base)).rejects.toThrow(/didn't match what Anur signed/);
    // A newer version in the feed is an update.
    const newer = feed(temp("anur-feed-new-"), ours.privateKey, "1.1.0");
    expect(
      (await store.updatesFrom(await readFeed(newer, ours.pub))).map((p) => p.version),
    ).toEqual(["1.1.0"]);
  });

  it("carries a real Ed25519 public key", () => {
    expect(Buffer.from(PLUGIN_KEY, "base64")).toHaveLength(44);
    expect(signedByAnur(Buffer.from("x"), "not a signature")).toBe(false);
  });
});
