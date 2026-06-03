import type { ChannelRuntimeContext, InboundMessage } from "@m3/channels";
import { saveChannelMedia } from "../media/store.js";

type SlackFile = {
  id?: string;
  name?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
};

export async function slackMessageToInbound(params: {
  runtime: ChannelRuntimeContext;
  accountId: string;
  botToken: string;
  event: {
    channel: string;
    user?: string;
    text?: string;
    thread_ts?: string;
    channel_type?: string;
    files?: SlackFile[];
  };
}): Promise<InboundMessage> {
  const { event, botToken, accountId, runtime } = params;
  const peerKind =
    event.channel_type === "im"
      ? "dm"
      : event.channel_type === "group"
        ? "group"
        : event.channel?.startsWith("D")
          ? "dm"
          : "group";

  let body = event.text?.trim() ?? "";
  const media: InboundMessage["media"] = [];

  for (const file of event.files ?? []) {
    const url = file.url_private_download ?? file.url_private;
    if (!url || !file.id) continue;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      if (!res.ok) continue;
      const data = Buffer.from(await res.arrayBuffer());
      const kind: "image" | "file" = file.mimetype?.startsWith("image/") ? "image" : "file";
      const saved = await saveChannelMedia({
        channelId: "slack",
        accountId,
        resourceId: file.id,
        data,
        mimeType: file.mimetype,
        kind,
      });
      media.push(saved);
      if (!body) body = file.name ? `[${kind}: ${file.name}]` : `[${kind} attached]`;
    } catch (err) {
      runtime.log(
        `slack file download failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    channelId: "slack",
    accountId,
    peerId: event.channel,
    peerKind,
    body: body || (media.length ? "[attachment]" : ""),
    threadId: event.thread_ts,
    media: media.length ? media : undefined,
    raw: event,
  };
}
