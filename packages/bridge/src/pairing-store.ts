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

export class PairingStore {
  private data: StoreData = { records: {} };

  constructor(private readonly dbPath = "~/.m3/pairing.json") {
    this.load();
  }

  private key(channel: string, accountId: string, peerId: string): string {
    return `${channel}:${accountId}:${peerId}`;
  }

  private load(): void {
    const resolved = expandHome(this.dbPath);
    if (!fs.existsSync(resolved)) return;
    try {
      this.data = JSON.parse(fs.readFileSync(resolved, "utf8")) as StoreData;
    } catch {
      this.data = { records: {} };
    }
  }

  private persist(): void {
    const resolved = expandHome(this.dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(this.data, null, 2));
  }

  getOrCreate(channel: string, accountId: string, peerId: string): PairingRecord {
    const k = this.key(channel, accountId, peerId);
    const existing = this.data.records[k];
    if (existing) return existing;
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const record: PairingRecord = {
      channel,
      accountId,
      peerId,
      code,
      approved: false,
      createdAt: new Date().toISOString(),
    };
    this.data.records[k] = record;
    this.persist();
    return record;
  }

  approve(channel: string, accountId: string, peerId: string, code: string): boolean {
    const rec = this.data.records[this.key(channel, accountId, peerId)];
    if (!rec || rec.code.toUpperCase() !== code.trim().toUpperCase()) return false;
    rec.approved = true;
    this.persist();
    return true;
  }

  isApproved(channel: string, accountId: string, peerId: string): boolean {
    return this.data.records[this.key(channel, accountId, peerId)]?.approved ?? false;
  }

  list(): PairingRecord[] {
    return Object.values(this.data.records);
  }
}
