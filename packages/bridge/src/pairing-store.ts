import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
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

/**
 * Crockford base32 alphabet — no I/L/O/U to avoid misreads ("0" vs "O",
 * "1" vs "I"). 6 chars from 32 symbols = 32^6 ≈ 1.07 billion
 * possibilities, so a 24h brute force at 100k guesses/s has < 1%
 * expected hit. Each random byte adds 1/256 collision risk with the
 * previous one, so we draw 6 fresh bytes for 48 bits of entropy.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Generate a cryptographically random pairing code. */
function generateCode(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += ALPHABET[bytes[i]! & 0x1f];
  }
  return out;
}

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
    // Atomic write via tmp + rename. Prevents a partial write from
    // leaving a corrupt file that load() would silently turn into
    // an empty store, losing every paired peer in one bad write.
    const tmp = `${resolved}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, resolved);
  }

  getOrCreate(channel: string, accountId: string, peerId: string): PairingRecord {
    const k = this.key(channel, accountId, peerId);
    const existing = this.data.records[k];
    if (existing && !this.isExpired(existing)) return existing;
    // Either no record, or the old one expired — mint a fresh one.
    // Retry a few times in the astronomically unlikely event the new
    // code collides with a still-live unapproved record for a
    // different peer (different keys, but the code space is shared).
    let code = generateCode();
    for (let attempt = 0; attempt < 4; attempt++) {
      const collision = Object.values(this.data.records).some(
        (r) => r.code === code && !r.approved,
      );
      if (!collision) break;
      code = generateCode();
    }
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
