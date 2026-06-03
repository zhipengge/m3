import fs from "node:fs";
import { expandHome } from "@m3/config";
import { z } from "zod";

/** Claude Desktop / Cursor compatible MCP server entry. */
export const McpServerEntrySchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
  type: z.enum(["stdio", "sse", "http"]).optional(),
});

export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;

export const McpConfigFileSchema = z.object({
  mcpServers: z.record(McpServerEntrySchema).default({}),
});

export type McpConfigFile = z.infer<typeof McpConfigFileSchema>;

export function loadMcpConfig(configPath?: string): Record<string, McpServerEntry> {
  if (!configPath) return {};
  const resolved = expandHome(configPath);
  if (!fs.existsSync(resolved)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
    const parsed = McpConfigFileSchema.parse(raw);
    return parsed.mcpServers;
  } catch {
    return {};
  }
}

export function mergeMcpServers(
  fromFile: Record<string, McpServerEntry>,
  inline?: Record<string, unknown>,
): Record<string, McpServerEntry> {
  const merged = { ...fromFile };
  if (!inline) return merged;
  for (const [name, entry] of Object.entries(inline)) {
    const parsed = McpServerEntrySchema.safeParse(entry);
    if (parsed.success) merged[name] = parsed.data;
  }
  return merged;
}
