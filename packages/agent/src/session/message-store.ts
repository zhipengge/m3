import fs from "node:fs";
import path from "node:path";
import { atomicWriteFileSync, expandHome } from "@m3/config";
import type { HarnessMessage } from "../harness/types.js";

type SessionRecord = {
  sessionId: string;
  messages: HarnessMessage[];
  updatedAt: string;
};

export class SessionMessageStore {
  constructor(private readonly basePath: string = "~/.m3/transcripts") {}

  private filePath(sessionId: string): string {
    return path.join(expandHome(this.basePath), `${sessionId}.json`);
  }

  private archiveDir(): string {
    return path.join(expandHome(this.basePath), "_archive");
  }

  load(sessionId: string): HarnessMessage[] {
    const fp = this.filePath(sessionId);
    if (!fs.existsSync(fp)) return [];
    try {
      const record = JSON.parse(fs.readFileSync(fp, "utf8")) as SessionRecord;
      return record.messages ?? [];
    } catch (err) {
      // Don't silently lose the entire transcript. Surface the corruption
      // so the user can recover (e.g. via /compact re-summarization)
      // rather than discovering a blank history the next morning.
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[m3:transcript] failed to parse ${fp}: ${msg}; starting empty\n`,
      );
      return [];
    }
  }

  /**
   * Move the transcript to `_archive/<ts>-<sid>.json` and return the
   * archive path. Returns null if the transcript didn't exist.
   *
   * Used by /clear soft-delete (B1): the user can /clear undo to
   * bring the file back. Hard delete is no longer the default
   * because accidentally losing a long session is unrecoverable.
   */
  archive(sessionId: string): string | null {
    const fp = this.filePath(sessionId);
    if (!fs.existsSync(fp)) return null;
    fs.mkdirSync(this.archiveDir(), { recursive: true });
    const ts = Date.now();
    const archivePath = path.join(this.archiveDir(), `${ts}-${sessionId}.json`);
    fs.renameSync(fp, archivePath);
    return archivePath;
  }

  /**
   * Restore the most recent archived transcript for a given session
   * id. Returns the restored sessionId on success, null if no
   * archive was found.
   *
   * The convention is: /clear undo always restores the *most recent*
   * archive (one-shot undo). For more control, expose `restoreArchive`
   * via a future /clear list / /clear pick flow.
   */
  restoreLatestArchive(sessionId: string): string | null {
    const dir = this.archiveDir();
    if (!fs.existsSync(dir)) return null;
    const matches = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(`-${sessionId}.json`))
      .sort();
    if (matches.length === 0) return null;
    const latest = matches[matches.length - 1]!;
    const from = path.join(dir, latest);
    const to = this.filePath(sessionId);
    // If the live transcript somehow re-appeared (e.g. an autosave
    // during the archive window), bail rather than overwriting.
    if (fs.existsSync(to)) return null;
    fs.renameSync(from, to);
    return sessionId;
  }

  /**
   * Low-level: hard delete. Still supported for callers that want
   * the old behavior (e.g. /clear --hard). The default `/clear`
   * path uses archive() instead so the transcript is recoverable.
   */
  clear(sessionId: string): void {
    const fp = this.filePath(sessionId);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  save(sessionId: string, messages: HarnessMessage[]): void {
    const fp = this.filePath(sessionId);
    // Transcripts contain the full conversation, which routinely
    // includes pasted API keys, file paths under $HOME, and tool
    // output we may not want other users on the host to read. Write
    // atomically at 0o600 via the shared helper.
    const record: SessionRecord = {
      sessionId,
      messages,
      updatedAt: new Date().toISOString(),
    };
    atomicWriteFileSync(fp, JSON.stringify(record, null, 2));
  }
}
