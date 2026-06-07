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
