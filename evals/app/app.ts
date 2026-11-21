/**
 * Drives the built Anur Dev app as a person would (Playwright on Electron),
 * in check mode, on a throwaway copy of a folder, with the person's real agent.
 */
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { tempDir } from "../temp.ts";

/** The part of Playwright the eval uses, typed here: its own types sit outside this package. */
interface Locator {
  first(): Locator;
  last(): Locator;
  nth(n: number): Locator;
  count(): Promise<number>;
  click(o?: { position?: { x: number; y: number } }): Promise<void>;
  hover(): Promise<void>;
  fill(text: string): Promise<void>;
  press(key: string): Promise<void>;
}
interface Page {
  locator(selector: string, o?: { hasText?: string | RegExp }): Locator;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(o: { path: string }): Promise<unknown>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  keyboard: { press(key: string): Promise<void> };
  mouse: { move(x: number, y: number): Promise<void> };
  on(event: "console", f: (m: { type(): string; text(): string }) => void): void;
  on(event: "pageerror", f: (e: Error) => void): void;
}
interface ElectronApp {
  firstWindow(): Promise<Page>;
  close(): Promise<void>;
}
interface PW {
  _electron: {
    launch(o: {
      args: string[];
      cwd: string;
      env: Record<string, string | undefined>;
    }): Promise<ElectronApp>;
  };
}

const desktop = createRequire(new URL("../../packages/desktop/package.json", import.meta.url));
const { _electron } = desktop("playwright") as PW;
export const APP_DIR = path.join(import.meta.dirname, "../../packages/desktop");

type ThreadLite = {
  id: string;
  title: string;
  busy: boolean;
  purpose: string | null;
  action?: { state: string } | null;
  items: { kind: string; role?: string; text?: string; title?: string }[];
};

export class Session {
  readonly space: string;
  readonly doc: string;
  readonly shots: string;
  private app: ElectronApp | null = null;
  private page: Page | null = null;
  readonly errors: string[] = [];
  private n = 0;

  private constructor(space: string, doc: string, shots: string) {
    this.space = space;
    this.doc = doc;
    this.shots = shots;
  }

  /** A fresh folder holding `files`, and the app opened on `doc` in it. */
  static async open(files: Record<string, string>, doc: string, shots: string): Promise<Session> {
    const root = await tempDir("anur-app-eval-");
    const space = path.join(root, "space");
    await mkdir(space);
    for (const [name, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(space, name)), { recursive: true });
      await writeFile(path.join(space, name), text);
    }
    await mkdir(shots, { recursive: true });
    const s = new Session(space, doc, shots);
    s.app = await _electron.launch({
      args: ["."],
      cwd: APP_DIR,
      env: {
        ...process.env,
        ANUR_CHECK_PROFILE: path.join(root, "profile"),
        ANUR_OPEN_FOLDER: space,
        ANUR_CHECK_OPEN_FILE: path.join(space, doc),
        ANUR_SCREENSHOT: path.join(root, "exit.png"),
        // Keeps the check-mode window open until the eval closes it.
        ANUR_SCREENSHOT_PROBE: "new Promise((r) => setTimeout(r, 3600000))",
      },
    });
    s.page = await s.app.firstWindow();
    s.page.on("console", (m) => {
      if (m.type() === "error") s.errors.push(m.text().slice(0, 300));
    });
    s.page.on("pageerror", (e) => s.errors.push(String(e).slice(0, 300)));
    await s.page.waitForTimeout(6000);
    return s;
  }

  get win(): Page {
    if (!this.page) throw new Error("not open");
    return this.page;
  }

  async close(): Promise<void> {
    await this.app?.close();
  }

  async shot(name: string): Promise<string> {
    const file = path.join(this.shots, `${String(++this.n).padStart(2, "0")}-${name}.png`);
    await this.win.screenshot({ path: file });
    return file;
  }

  // What a person does

  async select(section: string): Promise<void> {
    await this.win.locator(".map-box", { hasText: section }).first().click();
    await this.win.waitForTimeout(600);
  }

  /** Start a new thread from a section's hover card, as a person does (30.37). */
  async newThread(section: string): Promise<void> {
    // Off any hover card first, so it can't cover the box.
    await this.win.mouse.move(5, 5);
    await this.win.waitForTimeout(400);
    await this.win.locator(".map-box", { hasText: section }).first().hover();
    await this.win.waitForTimeout(1200);
    await this.win.locator(".map-peek-new").click();
    await this.win.waitForTimeout(800);
  }

  /** Type in Think's box and send, then wait for the agent to finish. */
  async ask(text: string): Promise<void> {
    const box = this.win.locator("aside.right-sidebar textarea").last();
    await box.click();
    await box.fill(text);
    await box.press("Enter");
    await this.idle();
  }

  /** Index and path of a section by its heading, in the doc as the page has it. */
  private async sectionRef(
    heading: string,
  ): Promise<{ index: number; path: string[]; text: string }> {
    return this.win.evaluate((h) => {
      const w = window as unknown as { anurView?: { state: { doc: { toString(): string } } } };
      const text = w.anurView?.state.doc.toString() ?? "";
      const heads = [...text.matchAll(/^(#{1,6})[ \t]+(.+)$/gm)].map((m) => ({
        depth: (m[1] ?? "").length,
        name: (m[2] ?? "").trim(),
      }));
      const stack: string[] = [];
      for (const [index, x] of heads.entries()) {
        stack.length = x.depth - 1;
        stack[x.depth - 1] = x.name;
        if (x.name === h) return { index, path: stack.filter(Boolean), text };
      }
      throw new Error(`no heading ${h}`);
    }, heading);
  }

  /**
   * Start a thread on a section with files attached, as the composer's paperclip
   * sends it (a file picker can't be driven), then wait for the reply.
   */
  async startWith(heading: string, message: string, files: string[] = []): Promise<string> {
    const at = await this.sectionRef(heading);
    const r = await this.win.evaluate(
      (a) =>
        (
          window as unknown as {
            anur: {
              call(c: string, x: unknown): Promise<{ kind: string; thread?: { id: string } }>;
            };
          }
        ).anur.call("thread:start", a),
      {
        path: this.doc,
        text: at.text,
        section: { index: at.index, path: at.path },
        message,
        files,
      },
    );
    if (r.kind !== "started" || !r.thread) throw new Error(`thread:start ${r.kind}`);
    await this.idle();
    return r.thread.id;
  }

  /** Add files as a section's inputs, as Add input does, for the threads that start there. */
  async addInputs(heading: string, files: string[]): Promise<unknown> {
    const at = await this.sectionRef(heading);
    return this.win.evaluate(
      (a) =>
        (
          window as unknown as { anur: { call(c: string, x: unknown): Promise<unknown> } }
        ).anur.call("inputs:add", a),
      {
        path: this.doc,
        text: at.text,
        section: { index: at.index, path: at.path },
        thread: null,
        files,
        links: [],
      },
    );
  }

  /** A thread's last reply, and the tools its agent called. */
  async replyOf(thread: string): Promise<{ text: string; tools: string[] }> {
    const t = (await this.threads()).find((x) => x.id === thread);
    const items = t?.items ?? [];
    return {
      text: items
        .filter((i) => i.kind === "message" && i.role === "agent")
        .map((i) => i.text ?? "")
        .join("\n"),
      tools: items.filter((i) => i.kind === "tool").map((i) => i.title ?? ""),
    };
  }

  async click(selector: string, text: string | RegExp, nth = 0): Promise<boolean> {
    const el = this.win.locator(selector, { hasText: text }).nth(nth);
    if ((await el.count()) === 0) return false;
    await el.click();
    await this.win.waitForTimeout(2500);
    return true;
  }

  async key(combo: string): Promise<void> {
    await this.win
      .locator(".map")
      .first()
      .click({ position: { x: 40, y: 300 } });
    await this.win.keyboard.press(combo);
    await this.win.waitForTimeout(1500);
  }

  // Waiting

  async threads(): Promise<ThreadLite[]> {
    return this.win.evaluate(async (doc) => {
      const w = window as unknown as {
        anurView?: { state: { doc: { toString(): string } } };
        anur: { call(c: string, a: unknown): Promise<{ threads: unknown[] }> };
      };
      const text = w.anurView?.state.doc.toString() ?? "";
      const r = await w.anur.call("thread:list", { path: doc, text });
      return r.threads as ThreadLite[];
    }, this.doc);
  }

  /** Until no thread runs and no planned action says Next, twice in a row. */
  async idle(ms = 1_500_000): Promise<number> {
    const start = Date.now();
    let calm = 0;
    while (Date.now() - start < ms) {
      await this.win.waitForTimeout(4000);
      const busy = (await this.threads().catch(() => [])).some((t) => t.busy);
      const next = await this.win.evaluate(() =>
        [...document.querySelectorAll(".map-action-waits")].some((e) => e.textContent === "Next"),
      );
      calm = !busy && !next ? calm + 1 : 0;
      if (calm >= 2) return Math.round((Date.now() - start) / 1000);
    }
    return -1;
  }

  // What a person sees

  think(): Promise<string> {
    return this.win.evaluate(
      () => document.querySelector<HTMLElement>("aside.right-sidebar")?.innerText ?? "",
    );
  }

  /** Each option row in Think: its text, and its name's lines (1 = one line). */
  optionRows(): Promise<
    { text: string; buttons: string[]; nameLines: number; labelLines: number }[]
  > {
    return this.win.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("aside.right-sidebar .think-offer")].map((o) => {
        const lines = (el: HTMLElement | null) => {
          if (!el) return 0;
          const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
          return Math.round(el.getBoundingClientRect().height / lh);
        };
        return {
          text: o.innerText.replace(/\s+/g, " ").trim(),
          buttons: [...o.querySelectorAll<HTMLElement>(".think-offer-actions button")].map((b) =>
            b.innerText.trim(),
          ),
          nameLines: lines(o.querySelector<HTMLElement>(".think-offer-name")),
          labelLines: lines(o.querySelector<HTMLElement>(".think-offer-head > .quiet")),
        };
      }),
    );
  }

  pills(): Promise<string[]> {
    return this.win.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".map-pill, .map-pill-group")].map((p) =>
        p.innerText.replace(/\s+/g, " ").trim(),
      ),
    );
  }

  /** Where a section's box is on the map, in map units (not moved by Fit or zoom). */
  boxAt(section: string): Promise<{ x: number; y: number } | null> {
    return this.win.evaluate((name) => {
      const el = [...document.querySelectorAll<HTMLElement>(".map-box[data-section]")].find(
        (e) => e.innerText.trim().split("\n")[0] === name,
      );
      return el ? { x: parseFloat(el.style.left), y: parseFloat(el.style.top) } : null;
    }, section);
  }

  /**
   * How far each of a box's handles sits from the middle of the line a person
   * sees (the blue ring outside a filled title box, else the border), in px.
   */
  handlesOff(box: string): Promise<number[]> {
    return this.win.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const ring = Number(/0px 0px 0px (\d+(?:\.\d+)?)px/.exec(cs.boxShadow)?.[1] ?? 0);
      const inset =
        el.classList.contains("title") && ring ? -ring / 2 : parseFloat(cs.borderTopWidth) / 2;
      const want: Record<string, number> = {
        left: r.left + inset,
        right: r.right - inset,
        top: r.top + inset,
        bottom: r.bottom - inset,
      };
      return [...el.querySelectorAll<HTMLElement>(".map-handle")].map((h) => {
        const c = h.getBoundingClientRect();
        const side = ["left", "right", "top", "bottom"].find((k) => h.classList.contains(k)) ?? "";
        const at =
          side === "left" || side === "right" ? (c.left + c.right) / 2 : (c.top + c.bottom) / 2;
        return Math.abs(at - (want[side] ?? at));
      });
    }, box);
  }

  /** Any notice on screen saying what the agent's edit did. */
  toasts(): Promise<string[]> {
    return this.win.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".notice, .notice-bar, [role=status]")]
        .map((n) => n.innerText.trim())
        .filter((t) => /agent's edit/i.test(t)),
    );
  }

  /** Pairs of map pieces that cover each other: boxes, choice cards, pills and folds. */
  overlaps(): Promise<string[]> {
    return this.win.evaluate(() => {
      const els = [
        ...document.querySelectorAll<HTMLElement>(".map-box, .map-option, .map-pill, .map-fold"),
      ].filter((e) => e.offsetParent !== null);
      const rects = els.map((e) => ({
        r: e.getBoundingClientRect(),
        name: e.innerText.replace(/\s+/g, " ").trim().slice(0, 40),
        el: e,
      }));
      const out: string[] = [];
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          if (!a || !b || a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (w > 4 && h > 4) out.push(`${a.name} / ${b.name}`);
        }
      return out;
    });
  }

  // What's on disk

  file(name = this.doc): Promise<string> {
    return readFile(path.join(this.space, name), "utf8");
  }

  async docs(): Promise<string[]> {
    return (await readdir(this.space)).filter((f) => !f.startsWith(".")).sort();
  }

  /** Every line of every .jsonl under .anur/<sub>, parsed. */
  async lines(sub: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const f of await readdir(dir).catch(() => [])) {
        const p = path.join(dir, f);
        if ((await stat(p)).isDirectory()) await walk(p);
        else if (f.endsWith(".jsonl"))
          for (const l of (await readFile(p, "utf8")).split("\n"))
            if (l.trim()) out.push(JSON.parse(l) as Record<string, unknown>);
      }
    };
    await walk(path.join(this.space, ".anur", sub));
    return out;
  }

  /** The folder as the eval left it, for a person to open after. */
  async keep(to: string): Promise<void> {
    await cp(this.space, to, { recursive: true });
  }
}
