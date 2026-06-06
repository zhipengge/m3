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
  onReasoningDelta?: (delta: string) => void;
  onSystem?: (text: string) => void;
  onTokens?: (usage: WebChatTokenUsage) => void;
  onToolUse?: (info: { id: string; name: string; input: unknown }) => void;
  onToolResult?: (info: { id: string; name: string; isError?: boolean }) => void;
};

/** Token usage event forwarded to the REPL. `cumulative` is the
 *  session running total so the consumer doesn't need to sum. */
export type WebChatTokenUsage = {
  input: number;
  output: number;
  total: number;
  cacheRead?: number;
  cacheCreation?: number;
  cumulative: { input: number; output: number; total: number };
};

type WebChatClient = {
  peerId: string;
  deliver: (text: string) => void;
  onTyping?: () => void;
  onDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  onSystem?: (text: string) => void;
  onTokens?: (usage: WebChatTokenUsage) => void;
  onToolUse?: (info: { id: string; name: string; input: unknown }) => void;
  onToolResult?: (info: { id: string; name: string; isError?: boolean }) => void;
};

const clients = new Map<string, WebChatClient>();

/**
 * Pending outbound buffer for peers that haven't registered a client yet.
 * Bounded per peer (default 32) to prevent unbounded memory growth when a
 * bot is firing messages at disconnected peers. Drop-oldest on overflow.
 */
const PENDING_QUEUE_MAX = 32;
const pendingOutbound = new Map<string, string[]>();

/** Bounded replacement for `pendingOutbound.get(key).push(msg)`. */
function enqueuePending(key: string, msg: string): void {
  const queue = pendingOutbound.get(key);
  if (queue) {
    if (queue.length >= PENDING_QUEUE_MAX) {
      queue.shift(); // drop oldest
    }
    queue.push(msg);
  } else {
    pendingOutbound.set(key, [msg]);
  }
}

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
    onReasoningDelta: handler.onReasoningDelta,
    onSystem: handler.onSystem,
    onTokens: handler.onTokens,
    onToolUse: handler.onToolUse,
    onToolResult: handler.onToolResult,
  };
}

export function registerWebChatClient(
  peerId: string,
  handler: ((text: string) => void) | WebChatReplSink,
): () => void {
  const client = normalizeHandler(peerId, handler);
  // If a prior client existed for this peer (e.g. the TUI re-mounted, or a
  // previous run left an orphan), drop its entry cleanly. The previous
  // returned cleanup callback is now a no-op — that's safe because the
  // unregister function checks for the live entry rather than identity.
  const prior = clients.get(peerId);
  void prior;
  clients.set(peerId, client);
  const key = queueKey("webchat", "default", peerId);
  const pending = pendingOutbound.get(key);
  if (pending) {
    for (const msg of pending) client.deliver(msg);
    pendingOutbound.delete(key);
  }
  let unregistered = false;
  return () => {
    if (unregistered) return;
    unregistered = true;
    // Only clear if our entry is still the live one (a fresh registration
    // would have replaced the map slot and is now the live owner).
    if (clients.get(peerId) === client) {
      clients.delete(peerId);
    }
  };
}

export function unregisterWebChatClient(peerId: string): void {
  clients.delete(peerId);
}

/** Push a streaming token to the terminal REPL when registered. */
export function pushWebChatDelta(peerId: string, delta: string): void {
  clients.get(peerId)?.onDelta?.(delta);
}

export function pushWebChatReasoningDelta(peerId: string, delta: string): void {
  clients.get(peerId)?.onReasoningDelta?.(delta);
}

export function pushWebChatSystem(peerId: string, text: string): void {
  clients.get(peerId)?.onSystem?.(text);
}

export function pushWebChatTokens(peerId: string, usage: WebChatTokenUsage): void {
  clients.get(peerId)?.onTokens?.(usage);
}

export function pushWebChatToolUse(
  peerId: string,
  info: { id: string; name: string; input: unknown },
): void {
  clients.get(peerId)?.onToolUse?.(info);
}

export function pushWebChatToolResult(
  peerId: string,
  info: { id: string; name: string; isError?: boolean },
): void {
  clients.get(peerId)?.onToolResult?.(info);
}

export function simulateWebChatInbound(
  runtime: ChannelRuntimeContext,
  peerId: string,
  body: string,
  media?: InboundMessage["media"],
): Promise<void> {
  const message: InboundMessage = {
    channelId: "webchat",
    accountId: "default",
    peerId,
    peerKind: "dm",
    body,
    media,
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
    // No live client — buffer up to PENDING_QUEUE_MAX messages, drop
    // oldest on overflow. A bot that never connects to a peer won't
    // OOM the process.
    const key = queueKey(message.channelId, message.accountId, message.peerId);
    enqueuePending(key, message.body);
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
    media: true,
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
