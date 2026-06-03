import type { M3Config } from "@m3/config";
import { addFeishuMessageReaction, getTenantAccessToken } from "./api.js";

export async function feishuReactToMessage(
  config: M3Config,
  accountId: string,
  messageId: string,
  emojiType = "THUMBSUP",
): Promise<void> {
  const account = config.channels.feishu?.[accountId];
  if (!account?.appId || !account?.appSecret) return;
  const token = await getTenantAccessToken(account.appId, account.appSecret);
  await addFeishuMessageReaction(token, messageId, emojiType);
}
