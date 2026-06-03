export type PermissionRequest = {
  id: string;
  toolName: string;
  description: string;
  sessionKey: string;
  createdAt: string;
  isReadOnly?: boolean;
};

export type PermissionDecision = "allow" | "deny";
