import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import type {
  FeedPlugin,
  OpenFrom,
  PluginContext,
  PluginInstance,
  PluginStatus,
  RunResult,
} from "@anur/core";

/**
 * Downloaded plugins running for each open folder (Plugins and Git mock). A
 * plugin is started when it's on for a folder and stopped when it's turned
 * off, the folder closes or Anur quits; each start gets its own context, so
 * one folder's plugin never sees another's.
 */

type Module = {
  activate: (ctx: PluginContext) => PluginInstance | Promise<PluginInstance>;
  openFrom?: OpenFrom;
};

/** What the app gives every plugin's context for one folder. */
export type HostFor = Omit<PluginContext, "every" | "onQuit" | "run" | "status"> & {
  /** The person's login PATH, so `git` and `gh` are found from Finder too. */
  path: () => Promise<string>;
  status: (plugin: string, s: PluginStatus | null) => void;
};

/** Runs a program, never throwing for a non-zero exit. */
export function runWith(pathEnv: () => Promise<string>): PluginContext["run"] {
  return async (cmd, args, opts = {}) => {
    const PATH = await pathEnv();
    return new Promise<RunResult>((resolve) => {
      execFile(
        cmd,
        args,
        {
          cwd: opts.cwd,
          timeout: opts.timeoutMs ?? 120_000,
          env: { ...process.env, PATH, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
          maxBuffer: 16 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          const code =
            err && typeof (err as { code?: unknown }).code === "number"
              ? (err as { code: number }).code
              : err
                ? 1
                : 0;
          resolve({ code, stdout, stderr: stderr || (err && !stdout ? err.message : "") });
        },
      );
    });
  };
}

const modules = new Map<string, Promise<Module>>();

/** A plugin's module, loaded once per file. */
export function loadModule(file: string): Promise<Module> {
  let m = modules.get(file);
  if (!m) {
    m = import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<Module>;
    modules.set(file, m);
  }
  return m;
}

type Running = {
  plugin: FeedPlugin;
  instance: PluginInstance;
  timers: Set<ReturnType<typeof setInterval>>;
  quit: (() => Promise<void>)[];
};

export class PluginRuntime {
  /** Folder path → plugin id → what's running. */
  private readonly running = new Map<string, Map<string, Running>>();

  async start(folder: string, plugin: FeedPlugin, file: string, host: HostFor): Promise<void> {
    await this.stop(folder, plugin.id);
    const mod = await loadModule(file);
    if (typeof mod.activate !== "function") throw new Error(`${plugin.name} has nothing to start.`);
    const timers = new Set<ReturnType<typeof setInterval>>();
    const quit: (() => Promise<void>)[] = [];
    const ctx: PluginContext = {
      ...host,
      run: runWith(host.path),
      status: (st) => {
        host.status(plugin.id, st);
      },
      every: (ms, fn) => {
        const t = setInterval(
          () => {
            void Promise.resolve()
              .then(fn)
              .catch(() => undefined);
          },
          Math.max(ms, 15_000),
        );
        timers.add(t);
        return () => {
          clearInterval(t);
          timers.delete(t);
        };
      },
      onQuit: (fn) => {
        quit.push(fn);
      },
    };
    const instance = await mod.activate(ctx);
    const forFolder = this.running.get(folder) ?? new Map<string, Running>();
    forFolder.set(plugin.id, { plugin, instance, timers, quit });
    this.running.set(folder, forFolder);
  }

  async stop(folder: string, id: string): Promise<void> {
    const r = this.running.get(folder)?.get(id);
    if (!r) return;
    for (const t of r.timers) clearInterval(t);
    this.running.get(folder)?.delete(id);
    await Promise.resolve(r.instance.stop?.()).catch(() => undefined);
  }

  async stopFolder(folder: string): Promise<void> {
    for (const id of [...(this.running.get(folder)?.keys() ?? [])]) await this.stop(folder, id);
    this.running.delete(folder);
  }

  isRunning(folder: string, id: string): boolean {
    return this.running.get(folder)?.has(id) ?? false;
  }

  async action(folder: string, id: string, action: string): Promise<string | null> {
    const fn = this.running.get(folder)?.get(id)?.instance.actions?.[action];
    if (!fn) return "That plugin isn't on for this folder.";
    try {
      return (await fn()) ?? null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  settingsChanged(folder: string, id: string): void {
    this.running.get(folder)?.get(id)?.instance.settingsChanged?.();
  }

  /** One folder's plugins' quit work, as when its window closes. */
  async quitFolder(folder: string, ms = 3500): Promise<void> {
    const work = [...(this.running.get(folder)?.values() ?? [])].flatMap((r) =>
      r.quit.map((fn) => fn().catch(() => undefined)),
    );
    await Promise.race([Promise.all(work), new Promise((r) => setTimeout(r, ms))]);
  }

  /** Every plugin's quit work, each given a few seconds, all at once. */
  async quitAll(ms = 8000): Promise<void> {
    const work = [...this.running.values()].flatMap((m) =>
      [...m.values()].flatMap((r) => r.quit.map((fn) => fn().catch(() => undefined))),
    );
    await Promise.race([Promise.all(work), new Promise((r) => setTimeout(r, ms))]);
  }
}
