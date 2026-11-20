#!/usr/bin/env node
/**
 * Release Anur: `pnpm release 0.1.0`, run on a Mac from a clean checkout of
 * origin/main. Builds the universal app, signs it with the Developer ID,
 * notarises and staples the app and the DMG, uploads them and the update
 * feed to S3 behind CloudFront, then tags the commit and makes a GitHub
 * release. Nothing releases unless this runs.
 *
 * Needs, once per Mac:
 *   xcrun notarytool store-credentials anur-notary --apple-id <id> --team-id D3YY6RV4C3
 *   aws sso login --profile aws-anur
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Arch, Platform, build } from "electron-builder";
import { feedBlock, gather } from "../src/shared/release-notes.ts";

const IDENTITY = "Harshit Khandelwal (D3YY6RV4C3)";
const NOTARY_PROFILE = "anur-notary";
const BUCKET = "anur-releases";
const DISTRIBUTION = "EVKBSGJARHF1U";
const SITE = "https://spaces.hianur.com";
const AWS = { ...process.env, AWS_PROFILE: "aws-anur" };

const here = path.dirname(new URL(import.meta.url).pathname);
const app = path.resolve(here, "..");
const root = path.resolve(app, "..", "..");
const dist = path.join(app, "dist");

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
const read = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8", ...opts }).trim();
const step = (s) => console.log(`\n▸ ${s}`);
const stop = (why) => {
  console.error(`\n✗ ${why}`);
  process.exit(1);
};

// 1. What's being released, and from where.
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) stop("Say the version: pnpm release 0.1.0");
const tag = `v${version}`;
step(`Releasing Anur ${version}`);
run("git", ["fetch", "--quiet", "--tags", "origin"]);
if (read("git", ["status", "--porcelain"]))
  stop("The checkout has changes; release from a clean one.");
const head = read("git", ["rev-parse", "HEAD"]);
if (head !== read("git", ["rev-parse", "origin/main"]))
  stop("HEAD isn't origin/main. Run: git checkout --detach origin/main");
if (read("git", ["tag", "--list", tag])) stop(`${tag} already exists.`);
const tags = read("git", ["tag", "--list", "v*", "--sort=-v:refname"]).split("\n").filter(Boolean);
const previous = tags[0] ?? null;

// What's new: each merged PR's "Release note", gathered before the long part
// so a missing one shows now. The PRs are those squash-merged since the last tag.
const prNumbers = [
  ...new Set(
    read("git", ["log", "--format=%s", previous ? `${previous}..HEAD` : "HEAD", "-n", "200"])
      .split("\n")
      .flatMap((s) => [...s.matchAll(/\(#(\d+)\)\s*$/g)].map((m) => Number(m[1]))),
  ),
];
const prs = prNumbers.map((n) =>
  JSON.parse(read("gh", ["pr", "view", String(n), "--json", "number,title,body"])),
);
const { notes, missing } = gather(prs);
step(`What's new in ${version}`);
for (const n of notes) console.log(`  - ${n}`);
if (notes.length === 0) console.log("  (no release notes written)");
if (missing.length) {
  console.log("\n  These PRs have no release note; write one in each PR's description, or 'none':");
  for (const m of missing) console.log(`    #${String(m.number)} ${m.title}`);
}

// 2. The tools it needs, checked before the long part.
try {
  read("xcrun", ["notarytool", "history", "--keychain-profile", NOTARY_PROFILE]);
} catch {
  stop(
    `No notarytool credentials named ${NOTARY_PROFILE}. Run once:\n  xcrun notarytool store-credentials ${NOTARY_PROFILE} --apple-id <your Apple ID> --team-id D3YY6RV4C3`,
  );
}
try {
  read("aws", ["sts", "get-caller-identity"], { env: AWS });
} catch {
  stop("AWS isn't signed in. Run: aws sso login --profile aws-anur");
}

// Plugins first, quickly: a plugin changed without a new version stops the release here.
step("Plugins");
run("node", ["scripts/plugins.mjs", "check"]);

// 3. Checks, then the app.
step("Checks");
run("pnpm", ["check"]);
run("pnpm", ["test:browser"]);
step("Build");
run("pnpm", ["--filter", "@anur/desktop", "build"]);
step("Package, sign and notarise (several minutes)");
rmSync(dist, { recursive: true, force: true });
process.env.APPLE_KEYCHAIN_PROFILE = NOTARY_PROFILE;
await build({
  projectDir: app,
  targets: Platform.MAC.createTarget(["dmg", "zip"], Arch.universal),
  publish: "never",
  config: {
    productName: "Anur",
    extraMetadata: { version, productName: "Anur" },
    artifactName: "Anur-${version}-${arch}.${ext}",
    mac: {
      identity: IDENTITY,
      hardenedRuntime: true,
      gatekeeperAssess: false,
      notarize: true,
    },
    // The DMG is signed too: Gatekeeper rejects an unsigned one on some Macs.
    dmg: {
      title: "Anur ${version}",
      sign: true,
      // Finder shows its toolbar and path bar on disk images now, so the icons
      // sit centred in what's left of the 540 × 380 window, not in all of it.
      window: { width: 540, height: 380 },
      // Our own backdrop: the default's arrow sits at y 220, below these icons.
      background: path.join(app, "build", "dmg-background.tiff"),
      contents: [
        { x: 140, y: 140, type: "file" },
        { x: 400, y: 140, type: "link", path: "/Applications" },
      ],
    },
  },
});

const files = readdirSync(dist).filter((f) => f.includes(version) || f === "latest-mac.yml");
const dmg = files.find((f) => f.endsWith(".dmg"));
const zip = files.find((f) => f.endsWith(".zip"));
if (!dmg || !zip) stop(`Expected a DMG and a zip in ${dist}; found ${files.join(", ")}`);

// 4. The DMG itself notarised and stapled, so a downloaded copy opens cleanly.
step("Notarise the DMG");
run("xcrun", [
  "notarytool",
  "submit",
  path.join(dist, dmg),
  "--keychain-profile",
  NOTARY_PROFILE,
  "--wait",
]);
run("xcrun", ["stapler", "staple", path.join(dist, dmg)]);
step("Check what macOS will see");
const appPath = path.join(dist, "mac-universal", "Anur.app");
run("codesign", ["--verify", "--deep", "--strict", appPath]);
run("spctl", ["--assess", "--type", "execute", "--verbose", appPath]);
run("xcrun", ["stapler", "validate", path.join(dist, dmg)]);
run("spctl", [
  "--assess",
  "--type",
  "open",
  "--context",
  "context:primary-signature",
  "--verbose",
  path.join(dist, dmg),
]);
// Stapling changed the DMG, so the feed's size and checksum for it are redone.
const feedFile = path.join(dist, "latest-mac.yml");
const dmgBytes = readFileSync(path.join(dist, dmg));
const sha = createHash("sha512").update(dmgBytes).digest("base64");
writeFileSync(
  feedFile,
  readFileSync(feedFile, "utf8").replace(
    new RegExp(String.raw`(- url: ${dmg.replaceAll(".", "\\.")}\n\s+sha512: )\S+(\n\s+size: )\d+`),
    `$1${sha}$2${String(dmgBytes.length)}`,
  ) + feedBlock(notes),
);

// 5. Up to S3: versioned files kept for good, the stable names short-lived.
step("Upload");
const put = (file, key, type, cache) =>
  run(
    "aws",
    [
      "s3",
      "cp",
      path.join(dist, file),
      `s3://${BUCKET}/${key}`,
      "--content-type",
      type,
      "--cache-control",
      cache,
    ],
    { env: AWS },
  );
const forever = "public, max-age=31536000, immutable";
put(zip, zip, "application/zip", forever);
for (const f of files.filter((f) => f.endsWith(".blockmap")))
  put(f, f, "application/octet-stream", forever);
put(dmg, dmg, "application/x-apple-diskimage", forever);
// The link to share is apps/Anur.dmg; Anur.dmg at the root stays for links already sent.
put(dmg, "apps/Anur.dmg", "application/x-apple-diskimage", "public, max-age=300");
put(dmg, "Anur.dmg", "application/x-apple-diskimage", "public, max-age=300");
// The feed last, so no app hears of a version before its files are there.
put("latest-mac.yml", "latest-mac.yml", "text/yaml", "public, max-age=60");
run(
  "aws",
  [
    "cloudfront",
    "create-invalidation",
    "--distribution-id",
    DISTRIBUTION,
    "--paths",
    "/apps/Anur.dmg",
    "/Anur.dmg",
    "/latest-mac.yml",
  ],
  { env: AWS, stdio: "ignore" },
);

// Plugins changed on main ship with the app: only the ones newer than the live feed go up.
step("Publish plugins");
run("node", ["scripts/plugins.mjs", "publish"]);

// 6. Tag the commit and say what's in it.
step("Tag and GitHub release");
const log = read("git", [
  "log",
  "--format=- %s",
  previous ? `${previous}..HEAD` : "HEAD",
  ...(previous ? [] : ["-n", "30"]),
]);
const body = [
  ...(notes.length ? ["## What's new", "", ...notes.map((n) => `- ${n}`), ""] : []),
  `**Download:** ${SITE}/apps/Anur.dmg (this version: ${SITE}/${dmg})`,
  "",
  "<details><summary>Every change" + (previous ? ` since ${previous}` : "") + "</summary>",
  "",
  log,
  "",
  "</details>",
].join("\n");
run("git", ["tag", "-a", tag, "-m", `Anur ${version}`]);
run("git", ["push", "origin", tag]);
run("gh", ["release", "create", tag, "--title", `Anur ${version}`, "--notes", body]);

console.log(`\n✓ Anur ${version} is out.\n  Share: ${SITE}/apps/Anur.dmg\n`);
