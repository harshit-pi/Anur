import { mkdir, mkdtemp, rename, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { TurnWatch, type DocChange } from "./turn-watch.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let watch: TurnWatch | null = null;
afterEach(() => {
  watch?.close();
  watch = null;
});

async function setup() {
  const folder = realpathSync(await mkdtemp(path.join(tmpdir(), "anur-watch-")));
  await writeFile(path.join(folder, "plan.md"), "# Plan\n\nShip in March.\n");
  const seen: { change: DocChange; threads: string[] }[] = [];
  watch = new TurnWatch(folder, (change, threads) => seen.push({ change, threads }), 50);
  return { folder, seen, w: watch };
}

describe("docs written during a turn", () => {
  it("reports a write from outside Anur, with the text before it", async () => {
    const { folder, seen, w } = await setup();
    await w.start("t1");
    await writeFile(path.join(folder, "plan.md"), "# Plan\n\nShip in May.\n");
    await wait(400);
    expect(seen).toEqual([
      {
        change: {
          rel: "plan.md",
          before: "# Plan\n\nShip in March.\n",
          after: "# Plan\n\nShip in May.\n",
        },
        threads: ["t1"],
      },
    ]);
  });

  it("never reports a doc moved or renamed during the turn", async () => {
    const { folder, seen, w } = await setup();
    await mkdir(path.join(folder, "Refined"));
    // Written well before the turn, as an old doc is.
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(path.join(folder, "plan.md"), old, old);
    await w.start("t1");
    await rename(path.join(folder, "plan.md"), path.join(folder, "Refined", "plan.md"));
    await wait(400);
    expect(seen).toEqual([]);
  });

  it("never reports Anur's own save", async () => {
    const { folder, seen, w } = await setup();
    await w.start("t1");
    w.ownWrite("plan.md", "# Plan\n\nShip in April.\n");
    await writeFile(path.join(folder, "plan.md"), "# Plan\n\nShip in April.\n");
    await wait(400);
    expect(seen).toEqual([]);
  });

  it("reports nothing once no turn runs", async () => {
    const { folder, seen, w } = await setup();
    await w.start("t1");
    w.stop("t1");
    await writeFile(path.join(folder, "plan.md"), "# Plan\n\nShip in June.\n");
    await wait(400);
    expect(seen).toEqual([]);
  });

  it("ignores files that aren't docs", async () => {
    const { folder, seen, w } = await setup();
    await w.start("t1");
    await writeFile(path.join(folder, "notes.txt"), "x");
    await wait(400);
    expect(seen).toEqual([]);
  });
});
