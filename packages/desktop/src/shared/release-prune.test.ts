import { describe, expect, it } from "vitest";
import { toPrune } from "./release-prune.ts";

const files = (v: string) => [
  `Anur-${v}-universal.dmg`,
  `Anur-${v}-universal.dmg.blockmap`,
  `Anur-${v}-universal.zip`,
  `Anur-${v}-universal.zip.blockmap`,
];

describe("pruning the release bucket", () => {
  it("deletes every file of all but the newest five versions, by version not by name", () => {
    const keys = ["0.1.8", "0.1.9", "0.1.10", "0.1.11", "0.1.12", "0.1.13", "0.2.0"].flatMap(files);
    const gone = toPrune(keys, "0.2.0");
    expect(gone).toEqual([...files("0.1.8"), ...files("0.1.9")]);
  });

  it("never touches the feed, the stable links or anything else", () => {
    const keys = [
      ...["0.1.1", "0.1.2", "0.1.3", "0.1.4", "0.1.5", "0.1.6"].flatMap(files),
      "latest-mac.yml",
      "Anur.dmg",
      "apps/Anur.dmg",
      "plugins/index.json",
      "fonts/x.woff2",
      "Anur-notes.txt",
    ];
    const gone = toPrune(keys, "0.1.6");
    expect(gone).toEqual(files("0.1.1"));
  });

  it("keeps the version just released even when newer ones are listed", () => {
    const keys = ["0.3.0", "0.3.1", "0.3.2", "0.3.3", "0.3.4", "0.2.9"].flatMap(files);
    expect(toPrune(keys, "0.2.9")).toEqual([]);
  });

  it("deletes nothing with five or fewer versions", () => {
    expect(toPrune(["0.1.1", "0.1.2"].flatMap(files), "0.1.2")).toEqual([]);
  });
});
