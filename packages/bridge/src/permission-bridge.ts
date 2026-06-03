import type { AgentConfig } from "@m3/config";
import { isFileMutationTool, isSameWorkspace } from "./workspace-access.js";

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
  private grantedWorkspace: string | null = null;

  constructor(private readonly config: AgentConfig) {}

  /** Grant read/write access for this session (set at m3 chat startup). */
  grantWorkspace(workspace: string): void {
    this.grantedWorkspace = workspace;
  }

  getGrantedWorkspace(): string | null {
    return this.grantedWorkspace;
  }

  isWorkspaceGranted(workspace?: string): boolean {
    if (!this.grantedWorkspace) return false;
    if (!workspace) return true;
    return isSameWorkspace(this.grantedWorkspace, workspace);
  }

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
    permissionMode?: AgentConfig["permissionMode"];
    workspaceRoot?: string;
  }): Promise<PermissionDecision> {
    const mode = params.permissionMode ?? this.config.permissionMode;
    if (mode === "bypassPermissions") {
      return "approve";
    }
    if (mode === "acceptEdits" && params.toolName !== "Bash") {
      return "approve";
    }
    if (params.isReadOnly) {
      return "approve";
    }

    const workspace = params.workspaceRoot;
    const workspaceOk = workspace ? this.isWorkspaceGranted(workspace) : Boolean(this.grantedWorkspace);

    if (workspaceOk && isFileMutationTool(params.toolName)) {
      return "approve";
    }

    if (
      !workspaceOk &&
      isFileMutationTool(params.toolName) &&
      (mode === "default" || mode === "acceptEdits")
    ) {
      return "deny";
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
    if (mode === "acceptEdits" && params.toolName !== "Bash") {
      return "approve";
    }
    if (mode === "default" && params.toolName !== "Bash") {
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
