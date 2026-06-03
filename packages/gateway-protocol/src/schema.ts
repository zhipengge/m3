export const GATEWAY_PROTOCOL_VERSION = "1.0.0";

export type GatewayRequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
};

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
};

export type GatewayFrame = GatewayRequestFrame | GatewayResponseFrame | GatewayEventFrame;

export const GatewayMethods = {
  CONNECT: "connect",
  HEALTH: "health",
  AGENT: "agent",
  AGENT_WAIT: "agent.wait",
  SEND: "send",
  CHANNELS_STATUS: "channels.status",
} as const;

export type AgentRequestParams = {
  sessionKey: string;
  message: string;
  agentId?: string;
  workspace?: string;
};

export type AgentResponsePayload = {
  runId: string;
  acceptedAt: string;
};

export type HealthPayload = {
  ok: boolean;
  version: string;
  uptimeMs: number;
};

export type ChannelStatusEntry = {
  channelId: string;
  accountId: string;
  configured: boolean;
  running: boolean;
  lastError?: string;
};

export type ChannelsStatusPayload = {
  channels: ChannelStatusEntry[];
};

export type StreamEventPayload = {
  runId: string;
  stream: "assistant" | "tool" | "lifecycle";
  delta?: string;
  phase?: "start" | "end" | "error";
  toolName?: string;
};
