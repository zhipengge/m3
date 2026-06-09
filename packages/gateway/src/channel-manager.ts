import type { M3Config } from "@m3/config";
import {
  getChannelPlugin,
  listChannelPlugins,
  type ChannelAccountSnapshot,
  type ChannelRuntimeContext,
} from "@m3/channels";

/**
 * Exponential backoff for account-start retries. The first delay is
 * short (5s) so a transient blip — say a Slack socket-mode token
 * hasn't replicated to all edge nodes — recovers quickly. Caps at
 * 5 minutes and gives up after 6 attempts (~32 minutes of total
 * budget) so a permanently-misconfigured account doesn't keep
 * spamming the log.
 */
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 180_000, 300_000, 300_000];
const MAX_RETRY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export class ChannelManager {
  private aborts = new Map<string, AbortController>();
  private snapshots = new Map<string, ChannelAccountSnapshot>();
  /** Tracks how many times each account has been started, so we can
   *  back off exponential-style. Reset on a successful start. */
  private retryAttempts = new Map<string, number>();
  /** Pending retry timers, so stopAll() can cancel them. */
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly config: M3Config,
    private readonly onInbound: ChannelRuntimeContext["onInbound"],
  ) {}

  async startAll(): Promise<void> {
    for (const plugin of listChannelPlugins()) {
      if (!plugin.gateway) continue;
      const accountIds = plugin.config.listAccountIds(this.config);
      for (const accountId of accountIds) {
        if (!plugin.config.isEnabled(this.config, accountId)) continue;
        await this.startAccount(plugin.id, accountId);
      }
    }
  }

  async startAccount(channelId: string, accountId: string): Promise<void> {
    const plugin = getChannelPlugin(channelId);
    if (!plugin?.gateway) return;

    const key = `${channelId}:${accountId}`;
    if (this.aborts.has(key)) return;

    const abort = new AbortController();
    this.aborts.set(key, abort);

    const configured = plugin.config.isConfigured(this.config, accountId);
    this.snapshots.set(key, {
      accountId,
      configured,
      running: false,
      lastStartedAt: new Date().toISOString(),
    });

    if (!configured) {
      this.updateSnapshot(key, { lastError: "not configured" });
      return;
    }

    const runtime: ChannelRuntimeContext = {
      config: this.config,
      onInbound: this.onInbound,
      log: (msg) => console.log(`[${channelId}:${accountId}] ${msg}`),
    };

    const attempt = this.retryAttempts.get(key) ?? 0;
    try {
      this.updateSnapshot(key, { running: true, lastError: undefined });
      await plugin.gateway.startAccount({ accountId, abortSignal: abort.signal, runtime });
      this.retryAttempts.set(key, 0); // success — reset backoff
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateSnapshot(key, { running: false, lastError: message });
      // Schedule a retry unless we've exhausted the budget. We do NOT
      // hold the abort controller — stopAll() should still be able to
      // stop an account that's between attempts. The new startAccount
      // call will reuse the existing key entry (no-op on the aborts.has
      // guard) so we cancel the old abort and let the next one win.
      if (attempt < MAX_RETRY_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt]!;
        runtime.log(`start failed (${message}); retrying in ${Math.round(delay / 1000)}s`);
        this.retryAttempts.set(key, attempt + 1);
        const timer = setTimeout(() => {
          this.retryTimers.delete(key);
          // Drop the existing abort controller so the next start isn't
          // a no-op against the "already running" guard.
          this.aborts.delete(key);
          void this.startAccount(channelId, accountId);
        }, delay);
        this.retryTimers.set(key, timer);
      } else {
        runtime.log(`start failed (${message}); giving up after ${attempt} attempts`);
        this.retryAttempts.delete(key);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    for (const [key, abort] of this.aborts) {
      abort.abort();
      const [channelId, accountId] = key.split(":");
      const plugin = getChannelPlugin(channelId!);
      await plugin?.gateway?.stopAccount?.({ accountId: accountId! });
      this.updateSnapshot(key, { running: false });
    }
    this.aborts.clear();
    this.retryAttempts.clear();
  }

  getSnapshots(): Array<ChannelAccountSnapshot & { channelId: string }> {
    return [...this.snapshots.entries()].map(([key, snap]) => {
      const channelId = key.includes(":") ? key.split(":")[0]! : key;
      return { channelId, ...snap };
    });
  }

  private updateSnapshot(key: string, patch: Partial<ChannelAccountSnapshot>): void {
    const current = this.snapshots.get(key);
    if (!current) return;
    this.snapshots.set(key, { ...current, ...patch });
  }
}
