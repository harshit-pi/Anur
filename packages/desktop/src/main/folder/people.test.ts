import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEVICE_ONLY } from "@anur/core";
import { openAnurFolder } from "../../vault/anur-folder.ts";
import { notePerson, peopleIn } from "./people.ts";
import { namesOf, noteOpened } from "./storage.ts";

const temp = (p: string) => mkdtempSync(path.join(tmpdir(), p));

describe("one person across their Macs", () => {
  it("is one entry per handle, named as they last set it on any Mac", async () => {
    const folder = temp("anur-people-");
    await notePerson(folder, "mac-a", "Harshit", "harshit-pi", new Date("2026-11-19T10:00:00Z"));
    await notePerson(folder, "mac-b", "Harshit K", "harshit-pi", new Date("2026-11-19T11:00:00Z"));
    await notePerson(folder, "mac-c", "Priya", "priya", new Date("2026-11-19T09:00:00Z"));
    const people = await peopleIn(folder);
    expect(people).toHaveLength(2);
    expect(people.find((p) => p.handle === "harshit-pi")).toEqual({
      handle: "harshit-pi",
      name: "Harshit K",
      devices: expect.arrayContaining(["mac-a", "mac-b"]) as string[],
    });
    const names = await namesOf(folder);
    expect([names.get("mac-a"), names.get("mac-b"), names.get("mac-c")]).toEqual([
      "Harshit K",
      "Harshit K",
      "Priya",
    ]);
  });

  it("writes a device's note only when its name or handle changes", async () => {
    const folder = temp("anur-people-quiet-");
    await notePerson(folder, "mac-a", "Sam", "sam", new Date("2026-11-19T10:00:00Z"));
    await notePerson(folder, "mac-a", "Sam", "sam", new Date("2026-11-19T12:00:00Z"));
    const [sam] = await peopleIn(folder);
    expect(sam?.name).toBe("Sam");
    expect(readdirSync(path.join(folder, ".anur", "people"))).toEqual(["mac-a.json"]);
  });
});

describe("names reach a teammate's clone (regression: names were only in the per-Mac open/)", () => {
  it("commits people notes, keeps open/ on the Mac, and a fresh clone still knows every name", async () => {
    const folder = temp("anur-people-git-");
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    git(folder, "init", "-q");
    git(folder, "config", "user.email", "t@example.com");
    git(folder, "config", "user.name", "T");
    await openAnurFolder(folder);
    // As opening the folder does: the per-Mac note, and the committed person note.
    await noteOpened(folder, "mac-a", new Date(), "Harshit");
    await notePerson(folder, "mac-a", "Harshit", "harshit-pi");
    git(folder, "add", "-A");
    const staged = git(folder, "diff", "--cached", "--name-only").split("\n");
    expect(staged).toContain(".anur/people/mac-a.json");
    expect(staged.some((f) => f.startsWith(".anur/open/"))).toBe(false);
    git(folder, "commit", "-qm", "folder");
    const clone = temp("anur-people-clone-");
    execFileSync("git", ["clone", "-q", folder, clone]);
    expect((await namesOf(clone)).get("mac-a")).toBe("Harshit");
  });

  it("never lists people or decisions among the per-Mac files", () => {
    for (const shared of ["people", "decisions"])
      expect(DEVICE_ONLY.some((d) => d.startsWith(shared))).toBe(false);
  });
});
