import type { M3Config } from "@m3/config";

export type ChannelId = string;

export type InboundMessage = {
  channelId: ChannelId;
  accountId: string;
  peerId: string;
  peerKind: "dm" | "group" | "thread";
  body: string;
  threadId?: string;
  /** Platform message id (e.g. Feishu message_id for reactions). */
  sourceMessageId?: string;
  media?: Array<{ type: "image" | "file"; path: string; mimeType?: string }>;
  raw?: unknown;
};

export type OutboundMessage = {
  channelId: ChannelId;
  accountId: string;
  peerId: string;
  body: string;
  threadId?: string;
  blocks?: string[];
  typing?: boolean;
};

export type ReplyPayload = {
  text: string;
  blocks?: string[];
  silent?: boolean;
};

export type ChannelAccountSnapshot = {
  accountId: string;
  configured: boolean;
  running: boolean;
  lastError?: string;
  lastStartedAt?: string;
};

export type ChannelRuntimeContext = {
  config: M3Config;
  onInbound: (message: InboundMessage) => Promise<void>;
  log: (msg: string) => void;
};

export type ChannelGatewayAdapter = {
  startAccount: (params: {
    accountId: string;
    abortSignal: AbortSignal;
    runtime: ChannelRuntimeContext;
  }) => Promise<void>;
  stopAccount?: (params: { accountId: string }) => Promise<void>;
};

export type ChannelOutboundAdapter = {
  send: (message: OutboundMessage) => Promise<void>;
  sendTyping?: (params: {
    channelId: ChannelId;
    accountId: string;
    peerId: string;
    threadId?: string;
    sourceMessageId?: string;
  }) => Promise<void>;
};

export type ChannelConfigAdapter = {
  listAccountIds: (config: M3Config) => string[];
  isConfigured: (config: M3Config, accountId: string) => boolean;
  isEnabled: (config: M3Config, accountId: string) => boolean;
};

export type ChannelSecurityAdapter = {
  isAllowedSender: (params: {
    config: M3Config;
    accountId: string;
    peerId: string;
  }) => boolean | Promise<boolean>;
};

export type ChannelPlugin = {
  id: ChannelId;
  meta: { label: string; docsUrl?: string };
  capabilities: {
    chatTypes: Array<"dm" | "group" | "thread">;
    media?: boolean;
    threading?: boolean;
    streaming?: boolean;
  };
  config: ChannelConfigAdapter;
  gateway?: ChannelGatewayAdapter;
  outbound?: ChannelOutboundAdapter;
  security?: ChannelSecurityAdapter;
};

export type ResolvedRoute = {
  agentId: string;
  sessionKey: string;
  channel: string;
  accountId: string;
  workspace?: string;
  matchedBy: string;
};

export type RouteInput = {
  config: M3Config;
  channel: string;
  accountId: string;
  peerId: string;
  peerKind: "dm" | "group" | "thread";
};
