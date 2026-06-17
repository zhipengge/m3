import type { AgentConfig } from "@m3/config";

/**
 * Permission mode for inbound channel messages (Feishu/Slack/WebChat).
 *
 * Default is `default` (not `bypassPermissions`). With the old default,
 * any remote user on a configured channel could trigger Bash/Write
 * without any approval ever being asked — there's no equivalent of
 * the REPL's workspace-grant prompt for channel runs. Falling back
 * to `default` means risky tools (Bash, Edit on files outside the
 * workspace, etc.) hit the permission manager and the operator can
 * configure `permissions.allow` for known-safe tools. Operators who
 * want the old behavior set `agent.channelPermissionMode:
 * "bypassPermissions"` explicitly.
 */
export function resolveChannelPermissionMode(
  agent: AgentConfig,
): AgentConfig["permissionMode"] {
  return agent.channelPermissionMode ?? "default";
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
