import type {
  ChannelGatewayAdapter,
  ChannelOutboundAdapter,
  ChannelPlugin,
  ChannelRuntimeContext,
  InboundMessage,
  OutboundMessage,
} from "@m3/channels";
import type { M3Config } from "@m3/config";

type WebChatClient = {
  peerId: string;
  send: (text: string) => void;
};

const clients = new Map<string, WebChatClient>();
const pendingOutbound = new Map<string, string[]>();

function queueKey(channelId: string, accountId: string, peerId: string): string {
  return `${channelId}:${accountId}:${peerId}`;
}

export function registerWebChatClient(peerId: string, send: (text: string) => void): () => void {
  clients.set(peerId, { peerId, send });
  const key = queueKey("webchat", "default", peerId);
  const pending = pendingOutbound.get(key) ?? [];
  for (const msg of pending) {
    send(msg);
  }
  pendingOutbound.delete(key);
  return () => clients.delete(peerId);
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
      client.send(message.body);
      return;
    }
    const key = queueKey(message.channelId, message.accountId, message.peerId);
    const queue = pendingOutbound.get(key) ?? [];
    queue.push(message.body);
    pendingOutbound.set(key, queue);
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
