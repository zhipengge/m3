import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerEntry } from "./config.js";

export type McpConnectedServer = {
  id: string;
  client: Client;
  close: () => Promise<void>;
};

/** Module-level registry of currently connected servers. Populated by
 *  connectMcpServer and cleared by close(). Exposed via listServers()
 *  for /mcp command listing and dashboard surfaces. */
const serverRegistry = new Map<string, McpConnectedServer>();

export function listServers(): McpConnectedServer[] {
  return [...serverRegistry.values()];
}

function inferTransportType(entry: McpServerEntry): "stdio" | "sse" {
  if (entry.type === "sse" || entry.type === "http") return "sse";
  if (entry.url) return "sse";
  return "stdio";
}

export async function connectMcpServer(id: string, entry: McpServerEntry): Promise<McpConnectedServer> {
  const client = new Client({ name: "m3-agent", version: "0.2.0" });
  const kind = inferTransportType(entry);

  // Register eagerly so a connection failure is visible to /mcp.
  // The actual close() removes it.
  const placeholder: McpConnectedServer = {
    id,
    client,
    close: async () => {
      serverRegistry.delete(id);
    },
  };
  serverRegistry.set(id, placeholder);

  if (kind === "sse") {
    if (!entry.url) throw new Error(`MCP server "${id}": url required for remote transport`);
    const transport = new SSEClientTransport(new URL(entry.url), {
      requestInit: entry.headers ? { headers: entry.headers } : undefined,
    });
    await client.connect(transport);
    const real: McpConnectedServer = {
      id,
      client,
      close: async () => {
        await client.close();
        serverRegistry.delete(id);
      },
    };
    serverRegistry.set(id, real);
    return real;
  }

  if (!entry.command) {
    throw new Error(`MCP server "${id}": command required for stdio transport`);
  }

  // Env isolation: MCP stdio children are user-defined third-party code
  // and MUST NOT inherit the parent process's secrets (API keys, GitHub
  // tokens, *_PROXY, *_SECRET, etc.) just by being on PATH. The previous
  // implementation copied the entire `process.env` and was a one-line
  // RCE-prelude for any malicious MCP server. We start from `{}` and
  // pass only a minimal allowlist (the bare essentials to spawn a child)
  // plus the server's own `entry.env` overrides.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "C.UTF-8",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
  };
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
  // Replace the placeholder with the real one whose close() closes
  // the underlying client AND removes the registry entry.
  const real: McpConnectedServer = {
    id,
    client,
    close: async () => {
      await client.close();
      serverRegistry.delete(id);
    },
  };
  serverRegistry.set(id, real);
  return real;
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
