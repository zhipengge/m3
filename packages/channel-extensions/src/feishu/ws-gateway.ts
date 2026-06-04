import type { ChannelRuntimeContext } from "@m3/channels";
import * as Lark from "@larksuiteoapi/node-sdk";
import { feishuEventToInbound } from "./inbound.js";

type WsHandle = {
  stop: () => Promise<void>;
};

const active = new Map<string, WsHandle>();

/** Feishu long connection — official WSClient, no public webhook / Verification Token. */
export async function startFeishuLongConnection(params: {
  accountId: string;
  appId: string;
  appSecret: string;
  runtime: ChannelRuntimeContext;
  abortSignal: AbortSignal;
}): Promise<void> {
  const key = `feishu:${params.accountId}`;
  if (active.has(key)) return;

  const client = new Lark.Client({
    appId: params.appId,
    appSecret: params.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
  });

  const wsClient = new Lark.WSClient({
    appId: params.appId,
    appSecret: params.appSecret,
    loggerLevel: Lark.LoggerLevel.error,
  });

  const noopEvent = async (): Promise<void> => {};

  const eventDispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data: unknown) => {
      try {
        const inbound = await feishuEventToInbound({
          runtime: params.runtime,
          accountId: params.accountId,
          event: data as Parameters<typeof feishuEventToInbound>[0]["event"],
        });
        if (inbound) await params.runtime.onInbound(inbound);
      } catch (err) {
        params.runtime.log(
          `feishu ws event error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    /** Ack-only events — avoid Lark SDK "no handle" warnings. */
    "im.message.reaction.created_v1": noopEvent,
    "im.message.message_read_v1": noopEvent,
  });

  await wsClient.start({ eventDispatcher });
  active.set(key, {
    stop: async () => {
      try {
        await wsClient.close();
      } catch {
        // ignore
      }
      void client;
    },
  });

  params.runtime.log(
    `feishu ${params.accountId}: long connection ready (enable long connection in Feishu Open Platform)`,
  );

  params.abortSignal.addEventListener("abort", () => {
    void active.get(key)?.stop();
    active.delete(key);
    params.runtime.log(`feishu ${params.accountId}: long connection closed`);
  });
}

export async function stopFeishuLongConnection(accountId: string): Promise<void> {
  const key = `feishu:${accountId}`;
  const handle = active.get(key);
  if (!handle) return;
  await Promise.race([
    handle.stop(),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  active.delete(key);
}
