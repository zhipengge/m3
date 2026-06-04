import fs from "node:fs";
import path from "node:path";
import { expandHome } from "@m3/config";

export type PairingRecord = {
  channel: string;
  accountId: string;
  peerId: string;
  code: string;
  approved: boolean;
  createdAt: string;
};

type StoreData = { records: Record<string, PairingRecord> };

/** Default pairing code lifetime. Codes older than this are evicted on load. */
export const DEFAULT_PAIRING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class PairingStore {
  private data: StoreData = { records: {} };
  private readonly now: () => number;

  constructor(
    private readonly dbPath = "~/.m3/pairing.json",
    opts: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_PAIRING_TTL_MS;
    this.now = opts.now ?? (() => Date.now());
    this.load();
  }

  private readonly ttlMs: number;

  private key(channel: string, accountId: string, peerId: string): string {
    return `${channel}:${accountId}:${peerId}`;
  }

  private isExpired(record: PairingRecord): boolean {
    if (record.approved) return false; // approved records never expire
    const created = Date.parse(record.createdAt);
    if (!Number.isFinite(created)) return true;
    return this.now() - created > this.ttlMs;
  }

  private evictExpired(): boolean {
    let changed = false;
    for (const [k, rec] of Object.entries(this.data.records)) {
      if (this.isExpired(rec)) {
        delete this.data.records[k];
        changed = true;
      }
    }
    return changed;
  }

  private load(): void {
    const resolved = expandHome(this.dbPath);
    if (!fs.existsSync(resolved)) return;
    try {
      this.data = JSON.parse(fs.readFileSync(resolved, "utf8")) as StoreData;
    } catch {
      this.data = { records: {} };
      return;
    }
    if (this.evictExpired()) this.persist();
  }

  private persist(): void {
    const resolved = expandHome(this.dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(this.data, null, 2));
  }

  getOrCreate(channel: string, accountId: string, peerId: string): PairingRecord {
    const k = this.key(channel, accountId, peerId);
    const existing = this.data.records[k];
    if (existing && !this.isExpired(existing)) return existing;
    // Either no record, or the old one expired — mint a fresh one.
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const record: PairingRecord = {
      channel,
      accountId,
      peerId,
      code,
      approved: false,
      createdAt: new Date(this.now()).toISOString(),
    };
    this.data.records[k] = record;
    this.persist();
    return record;
  }

  approve(channel: string, accountId: string, peerId: string, code: string): boolean {
    const k = this.key(channel, accountId, peerId);
    const rec = this.data.records[k];
    if (!rec) return false;
    if (this.isExpired(rec)) {
      // expired unapproved record — treat as not-found; user must re-request
      delete this.data.records[k];
      this.persist();
      return false;
    }
    if (rec.code.toUpperCase() !== code.trim().toUpperCase()) return false;
    rec.approved = true;
    this.persist();
    return true;
  }

  isApproved(channel: string, accountId: string, peerId: string): boolean {
    const rec = this.data.records[this.key(channel, accountId, peerId)];
    if (!rec) return false;
    if (this.isExpired(rec)) return false;
    return rec.approved;
  }

  list(): PairingRecord[] {
    this.evictExpired();
    return Object.values(this.data.records);
  }

  /** Test/debug helper: manually evict expired records. Returns count removed. */
  prune(): number {
    const before = Object.keys(this.data.records).length;
    const changed = this.evictExpired();
    if (changed) this.persist();
    return before - Object.keys(this.data.records).length;
  }
}
