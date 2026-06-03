import fs from "node:fs";
import path from "node:path";
import { expandHome } from "@m3/config";

export type SessionMapping = {
  sessionKey: string;
  claudeSessionId?: string;
  workspace?: string;
  agentId: string;
  channel: string;
  accountId: string;
  peerId: string;
  updatedAt: string;
};

type StoreData = {
  mappings: Record<string, SessionMapping>;
};

export class SessionMapper {
  private data: StoreData = { mappings: {} };

  constructor(private readonly dbPath: string) {
    this.load();
  }

  private load(): void {
    const resolved = expandHome(this.dbPath);
    if (!fs.existsSync(resolved)) return;
    try {
      this.data = JSON.parse(fs.readFileSync(resolved, "utf8")) as StoreData;
    } catch {
      this.data = { mappings: {} };
    }
  }

  private persist(): void {
    const resolved = expandHome(this.dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(this.data, null, 2));
  }

  get(sessionKey: string): SessionMapping | undefined {
    return this.data.mappings[sessionKey];
  }

  upsert(mapping: SessionMapping): void {
    this.data.mappings[mapping.sessionKey] = {
      ...mapping,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
  }

  setClaudeSessionId(sessionKey: string, claudeSessionId: string): void {
    const existing = this.data.mappings[sessionKey];
    if (!existing) return;
    existing.claudeSessionId = claudeSessionId;
    existing.updatedAt = new Date().toISOString();
    this.persist();
  }

  list(): SessionMapping[] {
    return Object.values(this.data.mappings);
  }

  remove(sessionKey: string): boolean {
    if (!this.data.mappings[sessionKey]) return false;
    delete this.data.mappings[sessionKey];
    this.persist();
    return true;
  }
}

export function inboundToPrompt(
  body: string,
  media?: Array<{ type: "image" | "file"; path: string; mimeType?: string }>,
): string {
  let prompt = body.trim();
  if (media?.length) {
    const lines = media.map(
      (m) => `- [${m.type}] ${m.path}${m.mimeType ? ` (${m.mimeType})` : ""}`,
    );
    prompt += `\n\n[Attachments — use Read tool on these paths if needed]\n${lines.join("\n")}`;
  }
  return prompt;
}
