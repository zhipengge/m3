import type { AgentConfig } from "@m3/config";

/** Permission mode for inbound channel messages (Feishu/Slack/WebChat). */
export function resolveChannelPermissionMode(
  agent: AgentConfig,
): AgentConfig["permissionMode"] {
  return agent.channelPermissionMode ?? "bypassPermissions";
}

export function agentConfigForChannel(agent: AgentConfig): AgentConfig {
  return {
    ...agent,
    permissionMode: resolveChannelPermissionMode(agent),
  };
}
