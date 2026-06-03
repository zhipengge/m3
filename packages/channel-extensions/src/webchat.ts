import type {
  ChannelGatewayAdapter,
  ChannelOutboundAdapter,
  ChannelPlugin,
  ChannelRuntimeContext,
  InboundMessage,
  OutboundMessage,
} from "@m3/channels";
import type { M3Config } from "@m3/config";

/** Rich REPL sink (Claude Code–style terminal UI). */
export type WebChatReplSink = {
  deliver: (text: string) => void;
  onTyping?: () => void;
  onDelta?: (delta: string) => void;
  onSystem?: (text: string) => void;
};

type WebChatClient = {
  peerId: string;
  deliver: (text: string) => void;
  onTyping?: () => void;
  onDelta?: (delta: string) => void;
  onSystem?: (text: string) => void;
};

const clients = new Map<string, WebChatClient>();
const pendingOutbound = new Map<string, string[]>();

function queueKey(channelId: string, accountId: string, peerId: string): string {
  return `${channelId}:${accountId}:${peerId}`;
}

function normalizeHandler(
  peerId: string,
  handler: ((text: string) => void) | WebChatReplSink,
): WebChatClient {
  if (typeof handler === "function") {
    return { peerId, deliver: handler };
  }
  return {
    peerId,
    deliver: handler.deliver,
    onTyping: handler.onTyping,
    onDelta: handler.onDelta,
    onSystem: handler.onSystem,
  };
}

export function registerWebChatClient(
  peerId: string,
  handler: ((text: string) => void) | WebChatReplSink,
): () => void {
  const client = normalizeHandler(peerId, handler);
  clients.set(peerId, client);
  const key = queueKey("webchat", "default", peerId);
  const pending = pendingOutbound.get(key) ?? [];
  for (const msg of pending) {
    client.deliver(msg);
  }
  pendingOutbound.delete(key);
  return () => clients.delete(peerId);
}

/** Push a streaming token to the terminal REPL when registered. */
export function pushWebChatDelta(peerId: string, delta: string): void {
  clients.get(peerId)?.onDelta?.(delta);
}

export function pushWebChatSystem(peerId: string, text: string): void {
  clients.get(peerId)?.onSystem?.(text);
}

export function simulateWebChatInbound(
  runtime: ChannelRuntimeContext,
  peerId: string,
  body: string,
): Promise<void> {
  const message: InboundMessage = {
    channelId: "webchat",
    accountId: "default",
    peerId,
    peerKind: "dm",
    body,
  };
  return runtime.onInbound(message);
}

const outbound: ChannelOutboundAdapter = {
  async send(message: OutboundMessage) {
    const client = clients.get(message.peerId);
    if (client) {
      client.deliver(message.body);
      return;
    }
    const key = queueKey(message.channelId, message.accountId, message.peerId);
    const queue = pendingOutbound.get(key) ?? [];
    queue.push(message.body);
    pendingOutbound.set(key, queue);
  },
  async sendTyping(params: {
    channelId: string;
    accountId: string;
    peerId: string;
  }) {
    const client = clients.get(params.peerId);
    client?.onTyping?.();
  },
};

const gateway: ChannelGatewayAdapter = {
  async startAccount({ accountId, runtime }) {
    runtime.log(`webchat account ${accountId} started (in-process)`);
  },
  async stopAccount({ accountId }) {
    void accountId;
  },
};

export const webchatPlugin: ChannelPlugin = {
  id: "webchat",
  meta: { label: "WebChat", docsUrl: "https://docs.openclaw.ai/channels/webchat" },
  capabilities: {
    chatTypes: ["dm"],
    media: false,
    streaming: true,
  },
  config: {
    listAccountIds: () => ["default"],
    isConfigured: () => true,
    isEnabled: (_config: M3Config, _accountId: string) => true,
  },
  gateway,
  outbound,
  security: {
    isAllowedSender: () => true,
  },
};
