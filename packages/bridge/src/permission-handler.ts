import type { PermissionHandler } from "@m3/agent";
import type { AgentConfig } from "@m3/config";
import { PermissionBridge } from "./permission-bridge.js";

/** Maps bridge approve/deny to harness allow/deny for in-process tool runs. */
export function createPermissionHandler(
  bridge: PermissionBridge,
  resolveMode?: () => AgentConfig["permissionMode"],
  workspaceRoot?: string,
): PermissionHandler {
  return async (request) => {
    const decision = await bridge.requestApproval({
      toolName: request.toolName,
      description: request.description,
      sessionKey: request.sessionKey,
      isReadOnly: request.isReadOnly,
      permissionMode: resolveMode?.(),
      workspaceRoot,
    });
    return decision === "approve" ? "allow" : "deny";
  };
}
