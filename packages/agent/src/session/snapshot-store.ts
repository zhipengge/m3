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
