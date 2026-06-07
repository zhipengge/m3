import type { AgentConfig } from "@m3/config";
import type { PermissionRequest } from "../permissions/types.js";
import { findMatchingPattern } from "./pattern-matcher.js";

export type PermissionDecision = "allow" | "deny";

export type PermissionHandler = (request: PermissionRequest) => Promise<PermissionDecision>;

export class PermissionManager {
  private handler?: PermissionHandler;

  constructor(
    private readonly mode: AgentConfig["permissionMode"],
    /**
     * B10: user-declared allow / deny pattern lists. Evaluated
     * BEFORE the mode-based decision so a `permissions.deny: ["Bash"]`
     * always blocks Bash even in bypassPermissions mode. In
     * bypassPermissions, allow lists are still respected (so a
     * paranoid user can say "even in bypass mode, never run Bash"
     * via deny, and "Read is always fine" via allow).
     */
    private readonly allowPatterns: string[] = [],
    private readonly denyPatterns: string[] = [],
  ) {}

  setHandler(handler: PermissionHandler): void {
    this.handler = handler;
  }

  async canUseTool(params: {
    toolName: string;
    toolInput?: unknown;
    isReadOnly: boolean;
    needsPermission: boolean;
    description: string;
    sessionKey?: string;
  }): Promise<PermissionDecision> {
    // Pattern-based shortcuts. Deny wins over allow. These run
    // BEFORE the mode check so a user with a paranoid policy
    // always has the final say.
    if (this.denyPatterns.length > 0) {
      const hit = findMatchingPattern(this.denyPatterns, params.toolName, params.toolInput);
      if (hit) return "deny";
    }
    if (this.allowPatterns.length > 0) {
      const hit = findMatchingPattern(this.allowPatterns, params.toolName, params.toolInput);
      if (hit) return "allow";
    }
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
