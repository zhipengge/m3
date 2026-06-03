import type { ChannelRuntimeContext, InboundMessage } from "@m3/channels";
import { saveChannelMedia } from "../media/store.js";
import { downloadFeishuMessageResource, getTenantAccessToken } from "./api.js";

type FeishuMessageEvent = {
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
  };
  sender?: {
    sender_id?: { open_id?: string; user_id?: string };
  };
};

export function parseFeishuEventBody(raw: unknown): FeishuMessageEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const envelope = raw as { event?: FeishuMessageEvent; header?: { event_type?: string } };
  if (envelope.header?.event_type === "im.message.receive_v1" && envelope.event) {
    return envelope.event;
  }
  if ("message" in envelope) return envelope as FeishuMessageEvent;
  return null;
}

export async function feishuEventToInbound(params: {
  runtime: ChannelRuntimeContext;
  accountId: string;
  event: FeishuMessageEvent;
}): Promise<InboundMessage | null> {
  const msg = params.event.message;
  const sender = params.event.sender?.sender_id?.open_id ?? params.event.sender?.sender_id?.user_id;
  if (!msg?.message_id || !sender) return null;

  const account = params.runtime.config.channels.feishu?.[params.accountId];
  if (!account?.appId || !account?.appSecret) return null;

  const peerId = msg.chat_id ?? sender;
  const peerKind = msg.chat_type === "group" ? "group" : "dm";
  let body = "";
  const media: InboundMessage["media"] = [];

  const token = await getTenantAccessToken(account.appId, account.appSecret);

  if (msg.message_type === "text" && msg.content) {
    try {
      const parsed = JSON.parse(msg.content) as { text?: string };
      body = parsed.text ?? msg.content;
    } catch {
      body = msg.content;
    }
  } else if (msg.message_type === "image" && msg.content) {
    try {
      const parsed = JSON.parse(msg.content) as { image_key?: string };
      if (parsed.image_key) {
        const { data, mimeType } = await downloadFeishuMessageResource({
          token,
          messageId: msg.message_id,
          fileKey: parsed.image_key,
          type: "image",
        });
        const saved = await saveChannelMedia({
          channelId: "feishu",
          accountId: params.accountId,
          resourceId: parsed.image_key,
          data,
          mimeType,
          kind: "image",
        });
        media.push(saved);
        body = "[image attached]";
      }
    } catch (err) {
      params.runtime.log(
        `feishu image download failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      body = "[image message — download failed]";
    }
  } else if (msg.message_type === "file" && msg.content) {
    try {
      const parsed = JSON.parse(msg.content) as { file_key?: string; file_name?: string };
      if (parsed.file_key) {
        const { data, mimeType } = await downloadFeishuMessageResource({
          token,
          messageId: msg.message_id,
          fileKey: parsed.file_key,
          type: "file",
        });
        const saved = await saveChannelMedia({
          channelId: "feishu",
          accountId: params.accountId,
          resourceId: parsed.file_key,
          data,
          mimeType,
          kind: "file",
        });
        media.push(saved);
        body = parsed.file_name ? `[file: ${parsed.file_name}]` : "[file attached]";
      }
    } catch (err) {
      params.runtime.log(
        `feishu file download failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      body = "[file message — download failed]";
    }
  } else {
    body = `[unsupported message_type: ${msg.message_type ?? "unknown"}]`;
  }

  return {
    channelId: "feishu",
    accountId: params.accountId,
    peerId,
    peerKind,
    body,
    sourceMessageId: msg.message_id,
    media: media.length ? media : undefined,
    raw: params.event,
  };
}

export async function handleFeishuWebhookPayload(params: {
  runtime: ChannelRuntimeContext;
  accountId: string;
  payload: unknown;
}): Promise<void> {
  const event = parseFeishuEventBody(params.payload);
  if (!event) return;
  const inbound = await feishuEventToInbound({
    runtime: params.runtime,
    accountId: params.accountId,
    event,
  });
  if (inbound) await params.runtime.onInbound(inbound);
}
