import fs from "node:fs";
import path from "node:path";
import { atomicWriteFileSync, expandHome } from "@m3/config";

/**
 * Session snapshot store — periodically copies the current
 * transcript to \`~/.m3/snapshots/<sessionId>/<ts>-<turn>.json\`
 * so the user can rewind to an earlier turn if the agent
 * went off the rails. Cheap (one fs.writeFileSync per
 * snapshot, only the modified message list) and safe
 * (atomic 0o600).
 *
 * Snapshots are taken automatically by the harness every N
 * turns (default 10). The store is just a flat file layout;
 * a future /rewind UI can list + restore them.
 */
export type SnapshotRecord = {
  sessionId: string;
  turn: number;
  ts: string;
  reason: "auto" | "manual";
  messageCount: number;
};

/**
 * Cap the number of snapshots kept per session. Each snapshot
 * is a verbatim copy of the message list, so a 1k-turn session
 * with no cap would leave ~100 copies of a 50k-token transcript
 * on disk — i.e. 5M tokens of JSON, easily 50MB. The cap keeps
 * it bounded; older snapshots are evicted oldest-first.
 *
 * `keepLatest` of 20 is the default — 20 × every-10-turns
 * snapshot = the last 200 turns are rewound-able, which covers
 * any realistic "I went off the rails 10 minutes ago" use
 * case without keeping the whole session history on disk.
 */
const DEFAULT_KEEP_LATEST = 20;

export class SnapshotStore {
  constructor(private readonly basePath: string = "~/.m3/snapshots") {}

  private dir(sessionId: string): string {
    return path.join(expandHome(this.basePath), sessionId);
  }

  private filePath(sessionId: string, ts: number, turn: number): string {
    return path.join(this.dir(sessionId), `${ts}-turn${turn}.json`);
  }

  /** Save a snapshot. \`messages\` is the full message list at
   *  this turn; it's written verbatim so a restore is lossless. */
  save(
    sessionId: string,
    turn: number,
    messages: unknown[],
    reason: "auto" | "manual" = "auto",
  ): SnapshotRecord {
    const dir = this.dir(sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    const record: SnapshotRecord = {
      sessionId,
      turn,
      ts: new Date(ts).toISOString(),
      reason,
      messageCount: messages.length,
    };
    // Single atomic write: the snapshot record + the messages
    // blob side by side, with the messages inlined so a
    // restore doesn't need a separate load.
    atomicWriteFileSync(this.filePath(sessionId, ts, turn), JSON.stringify({ ...record, messages }));
    return record;
  }

  /**
   * Garbage-collect old snapshots for a session, keeping only
   * the most recent `keepLatest` (default 20). Manual snapshots
   * are protected — a user-initiated `/rewind save` should
   * never be silently dropped. Returns the number of files
   * deleted (for tests / logs).
   */
  gc(sessionId: string, keepLatest: number = DEFAULT_KEEP_LATEST): number {
    const dir = this.dir(sessionId);
    if (!fs.existsSync(dir)) return 0;
    const all = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")) as SnapshotRecord;
          return { name: n, record: data };
        } catch {
          return { name: n, record: null as SnapshotRecord | null };
        }
      });
    // Manual snapshots are pinned — never delete them, even
    // when the cap is hit. Auto-snapshots are the only thing
    // GC'd. `keepLatest` controls how many autos survive, not
    // the total on disk; the cap is "at least N auto rewinds
    // available" not "at most N files".
    const autos = all
      .filter((e) => e.record?.reason !== "manual")
      .sort((a, b) => (b.record!.turn - a.record!.turn));
    const toDelete = autos.slice(keepLatest);
    let deleted = 0;
    for (const e of toDelete) {
      try {
        fs.unlinkSync(path.join(dir, e.name));
        deleted += 1;
      } catch {
        // best-effort; a single ENOENT shouldn't abort the GC
      }
    }
    return deleted;
  }

  /** List snapshots for a session, oldest first. */
  list(sessionId: string): SnapshotRecord[] {
    const dir = this.dir(sessionId);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")) as SnapshotRecord & {
            messages: unknown[];
          };
          // Strip the messages field for the listing shape.
          const { messages: _omit, ...rest } = data;
          return rest;
        } catch {
          return null;
        }
      })
      .filter((x): x is SnapshotRecord => x !== null)
      .sort((a, b) => a.turn - b.turn);
  }

  /** Read a snapshot's full message list. */
  load(sessionId: string, turn: number): unknown[] | null {
    const dir = this.dir(sessionId);
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(`-turn${turn}.json`));
    if (files.length === 0) return null;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, files[0]!), "utf8")) as {
        messages: unknown[];
      };
      return data.messages;
    } catch {
      return null;
    }
  }
}
