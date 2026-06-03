import type { M3Config } from "@m3/config";
import type { ResolvedRoute, RouteInput } from "./types.js";

const DEFAULT_ACCOUNT = "default";
const DEFAULT_AGENT = "coder";

export function buildSessionKey(params: {
  agentId: string;
  channel: string;
  accountId: string;
  peerId: string;
  dmScope?: "main" | "per-peer" | "per-channel-peer";
}): string {
  const scope = params.dmScope ?? "per-peer";
  if (scope === "main") {
    return `agent:${params.agentId}:main`;
  }
  if (scope === "per-channel-peer") {
    return `agent:${params.agentId}:${params.channel}:${params.accountId}:${params.peerId}`;
  }
  return `agent:${params.agentId}:${params.peerId}`;
}

export function resolveAgentRoute(input: RouteInput): ResolvedRoute {
  const { config, channel, accountId, peerId } = input;
  const dmScope = config.session?.dmScope ?? "per-peer";

  for (const binding of config.bindings) {
    if (binding.channel !== channel) continue;
    if (binding.account && binding.account !== accountId) continue;
    if (binding.peer && binding.peer !== peerId) continue;
    const agentId = binding.agent ?? DEFAULT_AGENT;
    return {
      agentId,
      channel,
      accountId,
      workspace: binding.workspace,
      sessionKey: buildSessionKey({ agentId, channel, accountId, peerId, dmScope }),
      matchedBy: binding.peer ? "binding.peer" : "binding.channel",
    };
  }

  const agentId = DEFAULT_AGENT;
  return {
    agentId,
    channel,
    accountId,
    sessionKey: buildSessionKey({ agentId, channel, accountId, peerId, dmScope }),
    matchedBy: "default",
  };
}

export function resolveDefaultAccount(config: M3Config, channelId: string): string {
  const channelConfig = config.channels[channelId as keyof typeof config.channels];
  if (channelConfig && typeof channelConfig === "object") {
    const ids = Object.keys(channelConfig);
    if (ids.length > 0) return ids[0]!;
  }
  return DEFAULT_ACCOUNT;
}
