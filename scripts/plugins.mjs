/**
 * Anur's standard plugins (Plugins and Git mock): each folder in plugins/ is
 * one plugin, a manifest and its source. This builds each into one ES
 * module, writes the feed's index with each file's hash, and signs the index
 * with Anur's plugin key, so the app installs nothing anyone else wrote.
 *
 *   pnpm plugins:feed <dir>     build and sign a feed into <dir>, to test with ANUR_PLUGIN_FEED
 *   pnpm plugins:publish        build, sign and upload the feed to Anur's site
 *
 * The private key is read from the macOS Keychain (service "anur-plugin-signing"),
 * else from ~/.anur-release/plugin-signing.pem.
 */
import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const BUCKET = "anur-releases";
const DISTRIBUTION = "EVKBSGJARHF1U";
const AWS = { ...process.env, AWS_PROFILE: "aws-anur" };

function privateKey() {
  try {
    const pem = execFileSync(
      "security",
      ["find-generic-password", "-s", "anur-plugin-signing", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return createPrivateKey(Buffer.from(pem, "base64").toString("utf8"));
  } catch {
    const file = path.join(homedir(), ".anur-release", "plugin-signing.pem");
    if (!existsSync(file)) throw new Error("No plugin signing key: see scripts/plugins.mjs.");
    return createPrivateKey(readFileSync(file, "utf8"));
  }
}

async function bundler() {
  const desktop = createRequire(path.join(root, "packages/desktop/package.json"));
  const viteRequire = createRequire(desktop.resolve("vite"));
  return import(pathToFileURL(viteRequire.resolve("rolldown")).href);
}

/** Builds every plugin into `out` and writes the signed index beside them. */
export async function buildFeed(out) {
  mkdirSync(out, { recursive: true });
  const { build } = await bundler();
  const plugins = [];
  for (const id of readdirSync(path.join(root, "plugins"))) {
    const dir = path.join(root, "plugins", id);
    if (!existsSync(path.join(dir, "manifest.json"))) continue;
    const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    const file = `${manifest.id}-${manifest.version}.mjs`;
    await build({
      input: path.join(dir, "src", "index.ts"),
      platform: "node",
      logLevel: "silent",
      output: { file: path.join(out, file), format: "esm" },
    });
    const sha256 = createHash("sha256")
      .update(readFileSync(path.join(out, file)))
      .digest("hex");
    plugins.push({ ...manifest, file, sha256 });
  }
  const index = Buffer.from(`${JSON.stringify({ plugins }, null, 1)}\n`);
  writeFileSync(path.join(out, "index.json"), index);
  writeFileSync(
    path.join(out, "index.json.sig"),
    sign(null, index, privateKey()).toString("base64"),
  );
  return plugins;
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "feed") {
  const out = path.resolve(arg ?? path.join(root, "plugins", ".feed"));
  const plugins = await buildFeed(out);
  console.log(`Feed in ${out}: ${plugins.map((p) => `${p.id} ${p.version}`).join(", ")}`);
} else if (cmd === "publish") {
  const out = mkdtempSync(path.join(tmpdir(), "anur-plugins-"));
  const plugins = await buildFeed(out);
  const put = (name, type, cache) =>
    execFileSync(
      "aws",
      [
        "s3",
        "cp",
        path.join(out, name),
        `s3://${BUCKET}/plugins/${name}`,
        "--content-type",
        type,
        "--cache-control",
        cache,
      ],
      { env: AWS, stdio: "inherit" },
    );
  for (const p of plugins) put(p.file, "text/javascript", "public, max-age=31536000, immutable");
  // The index last, so no app hears of a version before its file is there.
  put("index.json.sig", "text/plain", "public, max-age=60");
  put("index.json", "application/json", "public, max-age=60");
  execFileSync(
    "aws",
    [
      "cloudfront",
      "create-invalidation",
      "--distribution-id",
      DISTRIBUTION,
      "--paths",
      "/plugins/index.json",
      "/plugins/index.json.sig",
    ],
    { env: AWS, stdio: "ignore" },
  );
  console.log(`✓ Published ${plugins.map((p) => `${p.id} ${p.version}`).join(", ")}`);
} else {
  console.log("Usage: pnpm plugins:feed <dir> | pnpm plugins:publish");
}
