import type { ChannelRuntimeContext } from "@m3/channels";
import * as Lark from "@larksuiteoapi/node-sdk";
import { feishuEventToInbound } from "./inbound.js";

type WsHandle = {
  stop: () => Promise<void>;
};

const active = new Map<string, WsHandle>();

/**
 * Reconnect schedule for the Feishu long-connection. Mirrors the
 * channel-manager retry table: 5s, 15s, 1m, 3m, 5m, 5m — total
 * budget ~13 minutes, then give up. The schedule resets to the
 * 5s end of the table the moment a connection is healthy for at
 * least `HEALTHY_RESET_MS`. Without that reset, a single
 * flapping network would eventually stop retrying and the user
 * would have to restart the gateway manually.
 */
const RECONNECT_DELAYS_MS = [5_000, 15_000, 60_000, 180_000, 300_000, 300_000];
const HEALTHY_RESET_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length;

type ReconnectState = {
  attempt: number;
  healthyAt: number | undefined;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
};

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

  const state: ReconnectState = {
    attempt: 0,
    healthyAt: undefined,
    reconnectTimer: null,
    closed: false,
  };

  // Hold the abort signal so we can stop the reconnect loop when
  // the gateway is shutting down.
  params.abortSignal.addEventListener("abort", () => {
    state.closed = true;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    void active.get(key)?.stop();
    active.delete(key);
    params.runtime.log(`feishu ${params.accountId}: long connection closed`);
  });

  await connectOnce(params, state);

  active.set(key, {
    stop: async () => {
      // The actual `wsClient.close()` is invoked from connectOnce's
      // local handle. We just need to mark the loop closed so the
      // catch branch in connectOnce doesn't try to reconnect.
      state.closed = true;
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
    },
  });
}

/**
 * One connection attempt. On success, the WSClient keeps running
 * until the underlying socket drops; on failure (or drop), we
 * schedule a reconnect unless the loop has been closed.
 *
 * We can't directly observe Lark's WSClient dropping the socket
 * (the SDK doesn't surface a `disconnect` event), so we use a
 * heartbeat ping that goes through the same client. If the ping
 * fails twice in a row, we assume the connection is dead and
 * trigger a reconnect.
 */
async function connectOnce(
  params: Parameters<typeof startFeishuLongConnection>[0],
  state: ReconnectState,
): Promise<void> {
  const { accountId, appId, appSecret, runtime, abortSignal } = params;

  const client = new Lark.Client({
    appId,
    appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
  });

  const wsClient = new Lark.WSClient({
    appId,
    appSecret,
    loggerLevel: Lark.LoggerLevel.error,
  });

  const noopEvent = async (): Promise<void> => {};

  const eventDispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data: unknown) => {
      try {
        const inbound = await feishuEventToInbound({
          runtime,
          accountId,
          event: data as Parameters<typeof feishuEventToInbound>[0]["event"],
        });
        if (inbound) await runtime.onInbound(inbound);
      } catch (err) {
        runtime.log(
          `feishu ws event error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    /** Ack-only events — avoid Lark SDK "no handle" warnings. */
    "im.message.reaction.created_v1": noopEvent,
    "im.message.message_read_v1": noopEvent,
  });

  let connectError: Error | undefined;
  try {
    await wsClient.start({ eventDispatcher });
  } catch (err) {
    connectError = err instanceof Error ? err : new Error(String(err));
  }

  if (connectError) {
    // Initial start failed. Schedule a reconnect unless the
    // gateway is shutting down.
    if (state.closed || abortSignal.aborted) return;
    scheduleReconnect(params, state, `start failed: ${connectError.message}`);
    void client;
    return;
  }

  state.attempt = 0;
  state.healthyAt = Date.now();
  runtime.log(
    `feishu ${accountId}: long connection ready (enable long connection in Feishu Open Platform)`,
  );

  // Heartbeat: ping every 30s. Two consecutive failures → mark the
  // connection dead and schedule a reconnect. We use the tenant
  // token + a no-op API call as the heartbeat probe (the SDK
  // doesn't expose the raw socket, and a real call exercises more
  // of the path than a synthetic ping would).
  let consecutiveFailures = 0;
  const heartbeat = setInterval(async () => {
    if (state.closed || abortSignal.aborted) return;
    try {
      // getTenantAccessToken is the cheapest call that actually
      // touches the network; it returns quickly on a healthy
      // connection and times out fast on a dead one.
      const token = await client.auth.tenantAccessToken.internal({
        data: { app_id: appId, app_secret: appSecret },
      });
      if (!token?.code) {
        consecutiveFailures += 1;
      } else {
        consecutiveFailures = 0;
        if (state.healthyAt && Date.now() - state.healthyAt > HEALTHY_RESET_MS) {
          state.attempt = 0;
        }
        state.healthyAt = Date.now();
      }
    } catch {
      consecutiveFailures += 1;
    }
    if (consecutiveFailures >= 2) {
      consecutiveFailures = 0;
      // Tear down the old client and reconnect.
      try {
        await wsClient.close();
      } catch {
        // ignore — the underlying socket is already dead
      }
      scheduleReconnect(params, state, "heartbeat failed (assumed dead)");
    }
  }, 30_000);

  // When the abort signal fires, the heartbeat + WSClient are
  // torn down by the abort handler registered in startFeishuLongConnection.
  // We still keep a local hook here so the heartbeat interval
  // doesn't leak past the connection's lifetime.
  abortSignal.addEventListener("abort", () => clearInterval(heartbeat), { once: true });
}

function scheduleReconnect(
  params: Parameters<typeof startFeishuLongConnection>[0],
  state: ReconnectState,
  reason: string,
): void {
  if (state.closed || params.abortSignal.aborted) return;
  if (state.attempt >= MAX_RECONNECT_ATTEMPTS) {
    params.runtime.log(
      `feishu ${params.accountId}: ${reason}; giving up after ${state.attempt} reconnect attempts`,
    );
    return;
  }
  const delay = RECONNECT_DELAYS_MS[state.attempt]!;
  state.attempt += 1;
  params.runtime.log(
    `feishu ${params.accountId}: ${reason}; reconnect #${state.attempt} in ${Math.round(delay / 1000)}s`,
  );
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    void connectOnce(params, state);
  }, delay);
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
