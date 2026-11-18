import { createConnection } from "node:net";
import { createInterface } from "node:readline";

/**
 * Anur's MCP server (Agents and Models, "How the MCP server is reached";
 * task 3.12). The agent starts it as a small stdio program for one thread's
 * session, with that thread's token in its environment, never on its
 * command line. Each tool call goes on to Anur over one local socket that
 * only the person's account can open, and every request carries the token.
 *
 * It speaks just enough MCP for its tools: initialize, tools/list and
 * tools/call, as JSON-RPC lines on stdin and stdout.
 */

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method?: string; params?: unknown };

const TOOLS = [
  {
    name: "anur_read_section",
    description:
      "Read one section of a doc in the opened folder, by its heading. Returns the section's own text, from its heading to its first subheading, with its subsections' headings listed. While this thread has a working copy of the doc, it reads the working copy, so your own edits show. Use it to read a section outside the ones this thread was given, such as a sibling's full text.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          description:
            'The section\'s heading, such as "Retry timing", or its path from the doc\'s title, such as "Notifications > Retry timing".',
        },
        doc: {
          type: "string",
          description:
            "The doc's path in the folder, such as \"notes/plan.md\". Leave it out for this thread's own doc.",
        },
      },
      required: ["section"],
      additionalProperties: false,
    },
  },
  {
    name: "anur_offer_options",
    description:
      "Offer the person two or more alternatives for this thread's section, instead of listing them in your reply. Each option is a short title and the section's whole new text, without its heading. Anur shows them as cards in the thread and as boxes on the doc's map; the person picks one, and its text replaces the section's text in the doc. Don't also edit the doc for options you offer.",
    inputSchema: {
      type: "object",
      properties: {
        options: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: 'A few words that tell this option apart, such as "Payday aligned".',
              },
              text: {
                type: "string",
                description:
                  "The section's whole text if this option is picked, in Markdown, without the section's heading.",
              },
            },
            required: ["title", "text"],
            additionalProperties: false,
          },
        },
      },
      required: ["options"],
      additionalProperties: false,
    },
  },
];

const socket = process.env.ANUR_SOCKET ?? "";
const token = process.env.ANUR_TOKEN ?? "";

function write(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** One tool call, answered by Anur over the socket. */
function call(tool: string, args: unknown): Promise<{ text?: string; error?: string }> {
  return new Promise((resolve) => {
    const conn = createConnection(socket);
    let buf = "";
    const done = (r: { text?: string; error?: string }) => {
      conn.destroy();
      resolve(r);
    };
    conn.on("data", (d) => {
      buf += d.toString();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      try {
        done(JSON.parse(buf.slice(0, nl)) as { text?: string; error?: string });
      } catch {
        done({ error: "Anur's answer couldn't be read." });
      }
    });
    conn.on("error", () => {
      done({ error: "Anur isn't reachable. Is the app open?" });
    });
    conn.write(`${JSON.stringify({ token, tool, args })}\n`);
  });
}

async function handle(m: Rpc): Promise<void> {
  if (m.id === undefined || m.id === null) return; // A notification: nothing to answer.
  const reply = (result: object) => {
    write({ jsonrpc: "2.0", id: m.id, result });
  };
  switch (m.method) {
    case "initialize": {
      const asked = (m.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      reply({
        protocolVersion: typeof asked === "string" ? asked : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "anur", version: "1" },
      });
      return;
    }
    case "ping":
      reply({});
      return;
    case "tools/list":
      reply({ tools: TOOLS });
      return;
    case "tools/call": {
      const p = (m.params ?? {}) as { name?: unknown; arguments?: unknown };
      const name = typeof p.name === "string" ? p.name : "";
      if (!TOOLS.some((t) => t.name === name)) {
        reply({ content: [{ type: "text", text: `Anur has no tool ${name}.` }], isError: true });
        return;
      }
      const r = await call(name, p.arguments ?? {});
      reply(
        r.error
          ? { content: [{ type: "text", text: r.error }], isError: true }
          : { content: [{ type: "text", text: r.text ?? "" }] },
      );
      return;
    }
    default:
      write({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try {
    void handle(JSON.parse(line) as Rpc);
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
});
