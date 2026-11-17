import { randomBytes } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import path from "node:path";

/**
 * The one path into Anur for an agent's tools (Agents and Models, "How the
 * MCP server is reached"): a local socket in a folder only this account can
 * open. Every request carries a token made for one thread's session, and a
 * request without a known token is refused.
 */

export type ToolAnswer = { text: string } | { error: string };
export type ToolHandler = (tool: string, args: unknown) => Promise<ToolAnswer>;

export class AnurSocket {
  private server: Server | null = null;
  private readonly tokens = new Map<string, ToolHandler>();
  readonly path: string;

  /** `dir` holds the socket; its path stays short, as Unix sockets need. */
  constructor(private readonly dir: string) {
    this.path = path.join(dir, "s");
  }

  async start(): Promise<void> {
    if (this.server) return;
    await mkdir(this.dir, { recursive: true });
    await chmod(this.dir, 0o700);
    await rm(this.path, { force: true });
    const server = createServer((conn) => {
      let buf = "";
      conn.on("data", (d) => {
        buf += d.toString();
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = "";
        void this.answer(line).then((a) => {
          conn.end(`${JSON.stringify(a)}\n`);
        });
      });
      conn.on("error", () => undefined);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.path, resolve);
    });
    await chmod(this.path, 0o600);
    this.server = server;
  }

  private async answer(line: string): Promise<ToolAnswer> {
    let req: { token?: unknown; tool?: unknown; args?: unknown };
    try {
      req = JSON.parse(line) as typeof req;
    } catch {
      return { error: "Anur couldn't read that request." };
    }
    const handler = typeof req.token === "string" ? this.tokens.get(req.token) : undefined;
    if (!handler) return { error: "Anur refused the request: its token isn't one Anur gave out." };
    if (typeof req.tool !== "string") return { error: "Anur needs a tool name." };
    try {
      return await handler(req.tool, req.args ?? {});
    } catch (e) {
      return { error: `Anur couldn't answer: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** A new token for one thread's session, answered by `handler`. */
  issue(handler: ToolHandler): string {
    const token = randomBytes(24).toString("hex");
    this.tokens.set(token, handler);
    return token;
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  close(): void {
    this.server?.close();
    this.server = null;
  }
}
