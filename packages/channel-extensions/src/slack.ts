import { App } from "@slack/bolt";
import type { ChannelPlugin } from "@m3/channels";
import type { M3Config } from "@m3/config";
import { slackMessageToInbound } from "./slack/inbound.js";

const boltApps = new Map<string, App>();

/** Slack channel — Socket Mode event subscription + file download. */
export const slackPlugin: ChannelPlugin = {
  id: "slack",
  meta: { label: "Slack" },
  capabilities: {
    chatTypes: ["dm", "group", "thread"],
    media: true,
    threading: true,
    streaming: true,
  },
  config: {
    listAccountIds: (config: M3Config) => {
      const accounts = config.channels.slack;
      return accounts ? Object.keys(accounts) : [];
    },
    isConfigured: (config, accountId) => {
      const account = config.channels.slack?.[accountId];
      return Boolean(account?.botToken && account?.appToken);
    },
    isEnabled: (config, accountId) => {
      const account = config.channels.slack?.[accountId];
      return account?.enabled !== false;
    },
  },
  gateway: {
    async startAccount({ accountId, runtime, abortSignal }) {
      const account = runtime.config.channels.slack?.[accountId];
      const botToken = account?.botToken;
      const appToken = account?.appToken;
      if (!botToken || !appToken) {
        runtime.log(`slack ${accountId}: requires botToken + appToken (Socket Mode)`);
        return;
      }

      const app = new App({
        token: botToken,
        appToken,
        socketMode: true,
      });

      app.event("message", async ({ event, say }) => {
        if (event.subtype || !("user" in event) || event.user === undefined) return;
        if ("bot_id" in event && event.bot_id) return;

        const inbound = await slackMessageToInbound({
          runtime,
          accountId,
          botToken,
          event: {
            channel: event.channel,
            user: event.user,
            text: "text" in event ? event.text : undefined,
            thread_ts: "thread_ts" in event ? event.thread_ts : undefined,
            channel_type: "channel_type" in event ? event.channel_type : undefined,
            files: "files" in event ? (event.files as never) : undefined,
          },
        });

        if (!inbound.body && !inbound.media?.length) return;
        await runtime.onInbound(inbound);
        void say;
      });

      await app.start();
      boltApps.set(`slack:${accountId}`, app);
      runtime.log(`slack ${accountId}: Socket Mode connected`);

      abortSignal.addEventListener("abort", () => {
        void app.stop().then(() => {
          boltApps.delete(`slack:${accountId}`);
          runtime.log(`slack ${accountId}: stopped`);
        });
      });
    },
    async stopAccount({ accountId }) {
      const app = boltApps.get(`slack:${accountId}`);
      if (app) {
        await app.stop();
        boltApps.delete(`slack:${accountId}`);
      }
    },
  },
  outbound: {
    async send(message) {
      const app = boltApps.get(`slack:${message.accountId}`);
      if (!app) {
        throw new Error(`Slack account ${message.accountId} is not running`);
      }
      await app.client.chat.postMessage({
        channel: message.peerId,
        text: message.body,
        thread_ts: message.threadId,
      });
    },
    async sendTyping(params) {
      const app = boltApps.get(`slack:${params.accountId}`);
      if (!app) return;
      try {
        await app.client.reactions.add({
          name: "eyes",
          channel: params.peerId,
          timestamp: params.threadId ?? params.peerId,
        });
      } catch {
        // typing via reaction is best-effort
      }
    },
  },
  security: {
    isAllowedSender({ config, accountId, peerId }) {
      const account = config.channels.slack?.[accountId];
      if (!account) return false;
      if (account.dmPolicy === "open") return true;
      if (account.allowFrom.includes("*") || account.allowFrom.includes(peerId)) return true;
      return account.dmPolicy !== "closed";
    },
  },
};
