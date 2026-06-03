import type { ChannelPlugin } from "@m3/channels";
import { loadConfig, type M3Config } from "@m3/config";
import {
  addFeishuMessageReaction,
  getTenantAccessToken,
  sendFeishuText,
} from "./feishu/api.js";
import { startFeishuWebhookServer } from "./feishu/webhook.js";
import { startFeishuLongConnection, stopFeishuLongConnection } from "./feishu/ws-gateway.js";

const webhookServers = new Map<string, { close: () => Promise<void> }>();

/** Feishu/Lark — default long connection; optional webhook. */
export const feishuPlugin: ChannelPlugin = {
  id: "feishu",
  meta: { label: "Feishu" },
  capabilities: {
    chatTypes: ["dm", "group"],
    media: true,
    streaming: true,
  },
  config: {
    listAccountIds: (config: M3Config) => {
      const accounts = config.channels.feishu;
      return accounts ? Object.keys(accounts) : [];
    },
    isConfigured: (config, accountId) => {
      const account = config.channels.feishu?.[accountId];
      return Boolean(account?.appId && account?.appSecret);
    },
    isEnabled: (config, accountId) => {
      const account = config.channels.feishu?.[accountId];
      return account?.enabled !== false;
    },
  },
  gateway: {
    async startAccount({ accountId, runtime, abortSignal }) {
      const account = runtime.config.channels.feishu?.[accountId];
      if (!account?.appId || !account?.appSecret) {
        runtime.log(`feishu ${accountId}: not configured`);
        return;
      }

      const mode = account.connectionMode ?? "long";

      if (mode === "long") {
        await startFeishuLongConnection({
          accountId,
          appId: account.appId,
          appSecret: account.appSecret,
          runtime,
          abortSignal,
        });
        return;
      }

      const webhookPath = account.webhookPath ?? "/feishu/events";
      const webhookPort = account.webhookPort ?? runtime.config.gateway.port + 1;
      const key = `feishu:${accountId}`;

      const server = startFeishuWebhookServer({
        accountId,
        port: webhookPort,
        path: webhookPath,
        verificationToken: account.verificationToken,
        runtime,
        abortSignal,
      });
      webhookServers.set(key, server);

      runtime.log(
        `feishu ${accountId}: webhook http://127.0.0.1:${webhookPort}${webhookPath}`,
      );

      abortSignal.addEventListener("abort", () => {
        void server.close();
        webhookServers.delete(key);
        runtime.log(`feishu ${accountId}: stopped`);
      });
    },
    async stopAccount({ accountId }) {
      const account = loadConfig().channels.feishu?.[accountId];
      if ((account?.connectionMode ?? "long") === "long") {
        await stopFeishuLongConnection(accountId);
        return;
      }
      const key = `feishu:${accountId}`;
      const server = webhookServers.get(key);
      if (server) {
        await server.close();
        webhookServers.delete(key);
      }
    },
  },
  outbound: {
    async send(message) {
      const account = loadConfig().channels.feishu?.[message.accountId];
      if (!account?.appId || !account?.appSecret) {
        throw new Error(`Feishu account ${message.accountId} not configured`);
      }
      const token = await getTenantAccessToken(account.appId, account.appSecret);
      await sendFeishuText(token, message);
    },
    async sendTyping(params) {
      const messageId = params.sourceMessageId;
      if (!messageId) return;
      const account = loadConfig().channels.feishu?.[params.accountId];
      if (!account?.appId || !account?.appSecret) return;
      try {
        const token = await getTenantAccessToken(account.appId, account.appSecret);
        await addFeishuMessageReaction(token, messageId, "OK");
      } catch {
        // best-effort ack / typing indicator
      }
    },
  },
  security: {
    isAllowedSender({ config, accountId, peerId }) {
      const account = config.channels.feishu?.[accountId];
      if (!account) return false;
      if (account.dmPolicy === "open") return true;
      if (account.allowFrom.includes("*") || account.allowFrom.includes(peerId)) return true;
      return account.dmPolicy !== "closed";
    },
  },
};
