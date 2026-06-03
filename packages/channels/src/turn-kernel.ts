import type { ChannelPlugin, ChannelRuntimeContext, InboundMessage } from "./types.js";

export type TurnContext = {
  message: InboundMessage;
  runtime: ChannelRuntimeContext;
};

export async function dispatchInboundTurn(ctx: TurnContext): Promise<void> {
  await ctx.runtime.onInbound(ctx.message);
}

export function finalizeInboundContext(message: InboundMessage): InboundMessage {
  return {
    ...message,
    body: message.body.trim(),
  };
}

export type ReplyDispatcher = {
  deliver: (payload: { text: string; blocks?: string[] }) => Promise<void>;
  startTyping?: () => Promise<void>;
  stopTyping?: () => Promise<void>;
};

export function createReplyDispatcher(
  plugin: ChannelPlugin,
  target: Pick<
    InboundMessage,
    "channelId" | "accountId" | "peerId" | "threadId" | "sourceMessageId"
  >,
): ReplyDispatcher {
  return {
    deliver: async (payload) => {
      if (!plugin.outbound) {
        throw new Error(`Channel ${plugin.id} has no outbound adapter`);
      }
      await plugin.outbound.send({
        channelId: target.channelId,
        accountId: target.accountId,
        peerId: target.peerId,
        threadId: target.threadId,
        body: payload.text,
        blocks: payload.blocks,
      });
    },
    startTyping: plugin.outbound?.sendTyping
      ? async () => {
          await plugin.outbound!.sendTyping!({
            channelId: target.channelId,
            accountId: target.accountId,
            peerId: target.peerId,
            threadId: target.threadId,
            sourceMessageId: target.sourceMessageId,
          });
        }
      : undefined,
  };
}
