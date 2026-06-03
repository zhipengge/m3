import type { AgentConfig } from "@m3/config";

export type PermissionRequest = {
  id: string;
  toolName: string;
  description: string;
  sessionKey: string;
  createdAt: string;
  isReadOnly?: boolean;
};

export type PermissionDecision = "approve" | "deny";

export type PermissionPromptHandler = (
  request: PermissionRequest,
) => Promise<PermissionDecision>;

export class PermissionBridge {
  private pending = new Map<string, PermissionRequest>();
  private handlers: PermissionPromptHandler[] = [];

  constructor(private readonly config: AgentConfig) {}

  registerHandler(handler: PermissionPromptHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async requestApproval(params: {
    toolName: string;
    description: string;
    sessionKey: string;
    isReadOnly?: boolean;
  }): Promise<PermissionDecision> {
    if (this.config.permissionMode === "bypassPermissions") {
      return "approve";
    }
    if (this.config.permissionMode === "acceptEdits" && params.toolName !== "Bash") {
      return "approve";
    }
    if (params.isReadOnly) {
      return "approve";
    }

    const request: PermissionRequest = {
      id: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolName: params.toolName,
      description: params.description,
      sessionKey: params.sessionKey,
      createdAt: new Date().toISOString(),
    };
    this.pending.set(request.id, request);

    for (const handler of this.handlers) {
      try {
        const decision = await handler(request);
        this.pending.delete(request.id);
        return decision;
      } catch {
        continue;
      }
    }

    this.pending.delete(request.id);
    // No interactive handler (Feishu/Slack): allow edits & MCP; Bash still denied in default mode.
    if (this.config.permissionMode === "acceptEdits" && params.toolName !== "Bash") {
      return "approve";
    }
    if (this.config.permissionMode === "default" && params.toolName !== "Bash") {
      return "approve";
    }
    return "deny";
  }

  listPending(): PermissionRequest[] {
    return [...this.pending.values()];
  }
}

export function formatPermissionPrompt(request: PermissionRequest): string {
  return `Permission required for \`${request.toolName}\`:\n${request.description}\n\nReply APPROVE or DENY (id: ${request.id})`;
}
