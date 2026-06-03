import path from "node:path";
import type { McpServerEntry } from "./config.js";

const WORKSPACE_PLACEHOLDERS = new Set([
  "{{WORKSPACE}}",
  "${WORKSPACE}",
  "$WORKSPACE",
  ".",
]);

const LEGACY_TMP_ROOTS = new Set(["/tmp", "/private/tmp", "/var/tmp"]);

function replaceRootArg(arg: string, workspace: string): string {
  if (WORKSPACE_PLACEHOLDERS.has(arg)) return workspace;
  if (LEGACY_TMP_ROOTS.has(path.resolve(arg))) return workspace;
  return arg;
}

/** Point MCP filesystem servers at the agent workspace instead of /tmp. */
export function applyWorkspaceToMcpServers(
  servers: Record<string, McpServerEntry>,
  workspace: string,
): Record<string, McpServerEntry> {
  const resolved = path.resolve(workspace);
  const out: Record<string, McpServerEntry> = {};

  for (const [id, entry] of Object.entries(servers)) {
    if (!entry.args?.length) {
      out[id] = entry;
      continue;
    }
    const args = entry.args.map((a) => replaceRootArg(a, resolved));
    const isFilesystem =
      id === "filesystem" ||
      entry.args.some((a) => String(a).includes("server-filesystem"));
    if (isFilesystem && args.length > 0) {
      const last = args[args.length - 1]!;
      if (LEGACY_TMP_ROOTS.has(path.resolve(last)) || WORKSPACE_PLACEHOLDERS.has(last)) {
        args[args.length - 1] = resolved;
      }
    }
    out[id] = { ...entry, args };
  }
  return out;
}
