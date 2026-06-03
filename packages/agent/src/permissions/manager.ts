import type { AgentConfig } from "@m3/config";
import type { PermissionRequest } from "../permissions/types.js";

export type PermissionDecision = "allow" | "deny";

export type PermissionHandler = (request: PermissionRequest) => Promise<PermissionDecision>;

export class PermissionManager {
  private handler?: PermissionHandler;

  constructor(private readonly mode: AgentConfig["permissionMode"]) {}

  setHandler(handler: PermissionHandler): void {
    this.handler = handler;
  }

  async canUseTool(params: {
    toolName: string;
    isReadOnly: boolean;
    needsPermission: boolean;
    description: string;
    sessionKey?: string;
  }): Promise<PermissionDecision> {
    const ctx = { ...params, isReadOnly: params.isReadOnly };
    if (this.mode === "bypassPermissions") return "allow";
    if (this.mode === "plan") {
      return params.isReadOnly ? "allow" : "deny";
    }
    if (this.mode === "acceptEdits") {
      if (params.toolName === "Bash") return this.askOrDefault(ctx, "deny");
      return "allow";
    }
    if (params.isReadOnly) return this.askOrDefault(ctx, "allow");
    if (!params.needsPermission) return "allow";
    return this.askOrDefault(ctx, "deny");
  }

  private async askOrDefault(
    params: {
      toolName: string;
      description: string;
      sessionKey?: string;
      isReadOnly: boolean;
    },
    defaultDecision: PermissionDecision,
  ): Promise<PermissionDecision> {
    if (!this.handler) {
      if (params.isReadOnly) return "allow";
      if (params.toolName !== "Bash" && (this.mode === "acceptEdits" || this.mode === "default")) {
        return "allow";
      }
      return defaultDecision;
    }
    return this.handler({
      id: `perm-${Date.now()}`,
      toolName: params.toolName,
      description: params.description,
      sessionKey: params.sessionKey ?? "",
      createdAt: new Date().toISOString(),
      isReadOnly: params.isReadOnly,
    });
  }
}
