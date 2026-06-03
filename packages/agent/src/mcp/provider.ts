import type { AgentConfig } from "@m3/config";
import type { ToolDefinition, ToolResult } from "../harness/types.js";
import type { ToolProvider } from "../tools/tool-source.js";
import { resolveAgentWorkspace } from "@m3/config";
import { loadMcpConfig, mergeMcpServers, type McpServerEntry } from "./config.js";
import { applyWorkspaceToMcpServers } from "./workspace-roots.js";
import { connectMcpServer, listAllMcpTools, type McpConnectedServer } from "./pool.js";

function mcpToolName(prefix: string, serverId: string, toolName: string): string {
  const safeServer = serverId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${prefix}${safeServer}__${safeTool}`;
}

function parseQualifiedName(
  qualified: string,
  prefix: string,
): { serverId: string; toolName: string } | null {
  if (!qualified.startsWith(prefix)) return null;
  const rest = qualified.slice(prefix.length);
  const idx = rest.indexOf("__");
  if (idx <= 0) return null;
  return { serverId: rest.slice(0, idx), toolName: rest.slice(idx + 2) };
}

function formatMcpContent(content: unknown): string {
  if (!content) return "(empty)";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text: string }).text);
        }
        return JSON.stringify(block);
      })
      .join("\n");
  }
  return JSON.stringify(content, null, 2);
}

function toToolDefinition(
  prefix: string,
  server: McpConnectedServer,
  tool: { serverId: string; name: string; description?: string; inputSchema: unknown },
): ToolDefinition {
  const qualified = mcpToolName(prefix, tool.serverId, tool.name);
  const schema =
    tool.inputSchema && typeof tool.inputSchema === "object"
      ? (tool.inputSchema as ToolDefinition["inputSchema"])
      : { type: "object" as const, properties: {} };

  return {
    name: qualified,
    description: tool.description
      ? `[MCP:${tool.serverId}] ${tool.description}`
      : `[MCP:${tool.serverId}] ${tool.name}`,
    inputSchema: schema,
    needsPermission: true,
    execute: async (input): Promise<ToolResult> => {
      try {
        const result = await server.client.callTool({
          name: tool.name,
          arguments: (input ?? {}) as Record<string, unknown>,
        });
        const text = formatMcpContent(result.content);
        return { content: text, isError: Boolean(result.isError) };
      } catch (err) {
        return {
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        };
      }
    },
  };
}

let cachedServers: McpConnectedServer[] | null = null;
let cacheKey = "";

function resolveServers(config: AgentConfig): { key: string; entries: Record<string, McpServerEntry> } {
  const fromFile = loadMcpConfig(config.mcp?.config);
  const merged = mergeMcpServers(fromFile, config.mcp?.servers);
  const workspace = resolveAgentWorkspace(config);
  const entries = applyWorkspaceToMcpServers(merged, workspace);
  const key = JSON.stringify({ entries, workspace });
  return { key, entries };
}

async function getOrConnectServers(config: AgentConfig): Promise<McpConnectedServer[]> {
  const { key, entries } = resolveServers(config);
  if (Object.keys(entries).length === 0) return [];

  if (cachedServers && cacheKey === key) return cachedServers;

  if (cachedServers) {
    await Promise.all(cachedServers.map((s) => s.close().catch(() => {})));
    cachedServers = null;
  }

  const connected: McpConnectedServer[] = [];
  for (const [id, entry] of Object.entries(entries)) {
    try {
      connected.push(await connectMcpServer(id, entry));
    } catch (err) {
      process.stderr.write(
        `[m3:mcp] failed to connect "${id}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  cachedServers = connected;
  cacheKey = key;
  return connected;
}

/** Reset MCP connections (for tests or config reload). */
export async function resetMcpPool(): Promise<void> {
  if (cachedServers) {
    await Promise.all(cachedServers.map((s) => s.close().catch(() => {})));
  }
  cachedServers = null;
  cacheKey = "";
}

export const mcpToolProvider: ToolProvider = {
  id: "mcp",
  provide: async (config) => {
    const prefix = config.mcp?.toolPrefix ?? "mcp__";
    const servers = await getOrConnectServers(config);
    if (servers.length === 0) return { tools: [] };

    const catalog = await listAllMcpTools(servers);
    const byServer = new Map(servers.map((s) => [s.id, s]));
    const tools: ToolDefinition[] = [];

    for (const tool of catalog) {
      const server = byServer.get(tool.serverId);
      if (!server) continue;
      tools.push(toToolDefinition(prefix, server, tool));
    }

    return {
      tools,
      systemPrompt: [
        "## MCP Tools",
        `External MCP tools are available with prefix \`${prefix}\`. Original server tool names are listed per description.`,
        `Connected servers: ${servers.map((s) => s.id).join(", ")}.`,
        `Filesystem MCP roots are scoped to the agent workspace (${resolveAgentWorkspace(config)}). Use paths relative to that directory.`,
        `Use built-in Read/Write/Edit with file_path (workspace-relative). MCP write_file is not exposed when Write is available.`,
      ].join("\n"),
    };
  },
};

export { parseQualifiedName, mcpToolName };
