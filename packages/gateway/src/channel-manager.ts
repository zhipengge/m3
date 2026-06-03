import type { M3Config } from "@m3/config";
import {
  getChannelPlugin,
  listChannelPlugins,
  type ChannelAccountSnapshot,
  type ChannelRuntimeContext,
} from "@m3/channels";

export class ChannelManager {
  private aborts = new Map<string, AbortController>();
  private snapshots = new Map<string, ChannelAccountSnapshot>();

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

    try {
      this.updateSnapshot(key, { running: true, lastError: undefined });
      await plugin.gateway.startAccount({ accountId, abortSignal: abort.signal, runtime });
    } catch (err) {
      this.updateSnapshot(key, {
        running: false,
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async stopAll(): Promise<void> {
    for (const [key, abort] of this.aborts) {
      abort.abort();
      const [channelId, accountId] = key.split(":");
      const plugin = getChannelPlugin(channelId!);
      await plugin?.gateway?.stopAccount?.({ accountId: accountId! });
      this.updateSnapshot(key, { running: false });
    }
    this.aborts.clear();
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
