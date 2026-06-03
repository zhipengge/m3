import type { AgentConfig } from "@m3/config";

/** Permission mode for inbound channel messages (Feishu/Slack/WebChat). */
export function resolveChannelPermissionMode(
  agent: AgentConfig,
): AgentConfig["permissionMode"] {
  return agent.channelPermissionMode ?? "bypassPermissions";
}

export function agentConfigForChannel(
  agent: AgentConfig,
  inbound?: { channelId?: string; peerId?: string },
): AgentConfig {
  const isTerminalRepl =
    inbound?.channelId === "webchat" && inbound?.peerId === "terminal";
  return {
    ...agent,
    permissionMode: isTerminalRepl
      ? agent.permissionMode
      : resolveChannelPermissionMode(agent),
  };
}
