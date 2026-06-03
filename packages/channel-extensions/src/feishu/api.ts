import type { OutboundMessage } from "@m3/channels";

const FEISHU_API = "https://open.feishu.cn/open-apis";

type TokenCache = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenCache>();

export async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const key = `${appId}:${appSecret}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = (await res.json()) as {
    code?: number;
    tenant_access_token?: string;
    expire?: number;
  };
  if (!res.ok || json.code !== 0 || !json.tenant_access_token) {
    throw new Error(`Feishu auth failed: ${JSON.stringify(json)}`);
  }
  tokenCache.set(key, {
    token: json.tenant_access_token,
    expiresAt: Date.now() + (json.expire ?? 7200) * 1000,
  });
  return json.tenant_access_token;
}

/** Add emoji reaction to a message (requires im:message.reactions:write_only or im:message). */
export async function addFeishuMessageReaction(
  token: string,
  messageId: string,
  emojiType = "OK",
): Promise<void> {
  const res = await fetch(`${FEISHU_API}/im/v1/messages/${messageId}/reactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reaction_type: { emoji_type: emojiType },
    }),
  });
  const json = (await res.json()) as { code?: number; msg?: string };
  if (!res.ok || json.code !== 0) {
    throw new Error(`Feishu reaction failed: ${json.msg ?? res.statusText}`);
  }
}

export async function sendFeishuText(
  token: string,
  params: Pick<OutboundMessage, "peerId" | "body" | "threadId">,
): Promise<void> {
  const receiveIdType = params.peerId.startsWith("oc_") ? "chat_id" : "open_id";
  const res = await fetch(`${FEISHU_API}/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      receive_id: params.peerId,
      msg_type: "text",
      content: JSON.stringify({ text: params.body }),
    }),
  });
  const json = (await res.json()) as { code?: number; msg?: string };
  if (!res.ok || json.code !== 0) {
    throw new Error(`Feishu send failed: ${json.msg ?? res.statusText}`);
  }
}

export async function downloadFeishuMessageResource(params: {
  token: string;
  messageId: string;
  fileKey: string;
  type: "image" | "file";
}): Promise<{ data: Buffer; mimeType?: string }> {
  const url = `${FEISHU_API}/im/v1/messages/${params.messageId}/resources/${params.fileKey}?type=${params.type}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.token}` },
  });
  if (!res.ok) {
    throw new Error(`Feishu download failed: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") ?? undefined;
  return { data: buf, mimeType };
}
