#!/usr/bin/env node
/**
 * Deletes past versions' files from the release bucket, all but the newest 5
 * (src/shared/release-prune.ts). The release script runs it after uploading;
 * run by hand, it takes the current version and --dry-run to only list.
 *
 *   node scripts/prune-releases.mjs 0.1.40 [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { toPrune } from "../src/shared/release-prune.ts";

const BUCKET = "anur-releases";
const AWS = { ...process.env, AWS_PROFILE: "aws-anur" };
const current = process.argv[2];
const dry = process.argv.includes("--dry-run");
if (!current || !/^\d+\.\d+\.\d+$/.test(current)) {
  console.error("Give the version just released, such as 0.1.40.");
  process.exit(1);
}

// The bucket's top level only: apps/, plugins/ and fonts/ are never listed.
const listed = JSON.parse(
  execFileSync(
    "aws",
    ["s3api", "list-objects-v2", "--bucket", BUCKET, "--delimiter", "/", "--output", "json"],
    { env: AWS, encoding: "utf8" },
  ) || "{}",
);
const keys = (listed.Contents ?? []).map((o) => o.Key);
const gone = toPrune(keys, current);
const versions = [...new Set(gone.map((k) => k.split("-")[1]))];
if (gone.length === 0) {
  console.log("Nothing to prune: 5 or fewer versions in the bucket.");
  process.exit(0);
}
console.log(
  `${dry ? "Would delete" : "Deleting"} ${String(gone.length)} files of ${String(versions.length)} versions: ${versions.join(", ")}`,
);
if (dry) process.exit(0);
for (let i = 0; i < gone.length; i += 1000) {
  const batch = { Objects: gone.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true };
  execFileSync(
    "aws",
    ["s3api", "delete-objects", "--bucket", BUCKET, "--delete", JSON.stringify(batch)],
    { env: AWS, stdio: "inherit" },
  );
}
console.log("Done.");
