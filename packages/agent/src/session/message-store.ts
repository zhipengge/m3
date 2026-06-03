import fs from "node:fs";
import path from "node:path";
import { expandHome } from "@m3/config";
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
    } catch {
      return [];
    }
  }

  clear(sessionId: string): void {
    const fp = this.filePath(sessionId);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  save(sessionId: string, messages: HarnessMessage[]): void {
    const fp = this.filePath(sessionId);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const record: SessionRecord = {
      sessionId,
      messages,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(fp, JSON.stringify(record, null, 2));
  }
}
