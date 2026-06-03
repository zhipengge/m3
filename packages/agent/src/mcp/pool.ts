import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerEntry } from "./config.js";

export type McpConnectedServer = {
  id: string;
  client: Client;
  close: () => Promise<void>;
};

function inferTransportType(entry: McpServerEntry): "stdio" | "sse" {
  if (entry.type === "sse" || entry.type === "http") return "sse";
  if (entry.url) return "sse";
  return "stdio";
}

export async function connectMcpServer(id: string, entry: McpServerEntry): Promise<McpConnectedServer> {
  const client = new Client({ name: "m3-agent", version: "0.2.0" });
  const kind = inferTransportType(entry);

  if (kind === "sse") {
    if (!entry.url) throw new Error(`MCP server "${id}": url required for remote transport`);
    const transport = new SSEClientTransport(new URL(entry.url), {
      requestInit: entry.headers ? { headers: entry.headers } : undefined,
    });
    await client.connect(transport);
    return {
      id,
      client,
      close: async () => {
        await client.close();
      },
    };
  }

  if (!entry.command) {
    throw new Error(`MCP server "${id}": command required for stdio transport`);
  }

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  if (entry.env) {
    for (const [k, v] of Object.entries(entry.env)) env[k] = v;
  }

  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args ?? [],
    env,
    cwd: entry.cwd,
    stderr: "ignore",
  });
  await client.connect(transport);
  return {
    id,
    client,
    close: async () => {
      await client.close();
    },
  };
}

export async function listAllMcpTools(servers: McpConnectedServer[]) {
  const out: Array<{ serverId: string; name: string; description?: string; inputSchema: unknown }> = [];
  for (const server of servers) {
    let cursor: string | undefined;
    do {
      const page = await server.client.listTools({ cursor });
      for (const tool of page.tools) {
        out.push({
          serverId: server.id,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
  return out;
}
