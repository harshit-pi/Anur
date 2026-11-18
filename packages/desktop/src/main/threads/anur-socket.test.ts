import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AnurSocket } from "./anur-socket.ts";
import { readSection } from "./threads.ts";

const DOC = `# Notifications

Tell the client within an hour.

## Retry timing

Retry after 1, 3 and 7 days.

### Pay day

Use the pay day.

## Channel

Email.
`;

describe("readSection", () => {
  it("finds a section by its heading or its path, with its own text and its subsections named", () => {
    const r = readSection(DOC, "n.md", "retry timing", false);
    expect("text" in r && r.text).toBe(
      "Notifications > Retry timing (in n.md)\n\n## Retry timing\n\nRetry after 1, 3 and 7 days.\n\nIts subsections, not included: Pay day.",
    );
    const byPath = readSection(DOC, "n.md", "Retry timing > Pay day", true);
    expect("text" in byPath && byPath.text).toContain("(in n.md, your working copy)");
  });

  it("says which sections there are when the heading isn't one", () => {
    expect(readSection(DOC, "n.md", "Budget", false)).toEqual({
      error:
        'There\'s no section "Budget" in n.md. Its sections: Retry timing; Retry timing > Pay day; Channel.',
    });
  });
});

let socket: AnurSocket | null = null;
afterEach(() => {
  socket?.close();
  socket = null;
});

const ask = (path: string, line: object) =>
  new Promise<unknown>((resolve) => {
    const c = createConnection(path);
    let buf = "";
    c.on("data", (d) => {
      buf += d.toString();
      if (buf.includes("\n")) {
        c.destroy();
        resolve(JSON.parse(buf));
      }
    });
    c.write(`${JSON.stringify(line)}\n`);
  });

describe("Anur's tool socket", () => {
  it("answers a token it gave out, and refuses any other", async () => {
    socket = new AnurSocket(await mkdtemp(path.join(tmpdir(), "anur-s-")));
    await socket.start();
    const token = socket.issue((tool) => Promise.resolve({ text: `ran ${tool}` }));
    expect(await ask(socket.path, { token, tool: "anur_read_section", args: {} })).toEqual({
      text: "ran anur_read_section",
    });
    expect(await ask(socket.path, { token: "guess", tool: "x" })).toEqual({
      error: "Anur refused the request: its token isn't one Anur gave out.",
    });
    socket.revoke(token);
    expect(await ask(socket.path, { token, tool: "x" })).toHaveProperty("error");
  });

  it("serves the MCP program the agent starts: tools listed, a call answered", async () => {
    socket = new AnurSocket(await mkdtemp(path.join(tmpdir(), "anur-s-")));
    await socket.start();
    const token = socket.issue((_tool, args) =>
      Promise.resolve({ text: `section ${(args as { section: string }).section}` }),
    );
    const child = spawn(
      process.execPath,
      [path.join(import.meta.dirname, "../../agent/mcp-server.ts")],
      {
        env: { ...process.env, ANUR_SOCKET: socket.path, ANUR_TOKEN: token },
      },
    );
    const replies: Record<string, unknown>[] = [];
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        replies.push(JSON.parse(buf.slice(0, nl)) as Record<string, unknown>);
        buf = buf.slice(nl + 1);
      }
    });
    const send = (m: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    send({ method: "notifications/initialized" });
    send({ id: 2, method: "tools/list" });
    send({
      id: 3,
      method: "tools/call",
      params: { name: "anur_read_section", arguments: { section: "Risks" } },
    });
    for (let i = 0; i < 50 && replies.length < 3; i++) await new Promise((r) => setTimeout(r, 50));
    child.kill();
    const byId = new Map(replies.map((r) => [r.id, r.result as Record<string, unknown>]));
    expect(byId.get(1)).toMatchObject({ serverInfo: { name: "anur" } });
    expect((byId.get(2)?.tools as { name: string }[]).map((t) => t.name)).toEqual([
      "anur_read_section",
      "anur_offer_options",
      "anur_name_thread",
      "anur_list_inputs",
      "anur_read_input",
    ]);
    expect(byId.get(3)).toEqual({ content: [{ type: "text", text: "section Risks" }] });
  });
});
