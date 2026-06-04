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

/**
 * New entry point used when the inbound message carries image media that
 * should reach the LLM as a vision input (not just a path string).
 *
 * - No media → returns the plain string prompt (back-compat with every
 *   existing call site that never set `attachments`).
 * - Media with no text body → synthesises a placeholder so the user
 *   message still parses as a turn.
 * - Image media → emits `ContentBlock[]` with one `text` block plus one
 *   `image` block per attachment (path-mode source; providers base64 at
 *   send time).
 * - Non-image media (PDF, generic file) → keeps the legacy path-as-text
 *   behaviour: the LLM is told the path and is expected to use the Read
 *   tool. Vision inputs are the only thing we now inline.
 */
export type InboundMedia = {
  type: "image" | "file";
  path: string;
  mimeType?: string;
};

export type ImageContentBlock = {
  type: "image";
  source: { kind: "path"; path: string; mimeType: string };
};

export type TextContentBlock = { type: "text"; text: string };

export type UserMessage =
  | { role: "user"; content: string }
  | { role: "user"; content: Array<TextContentBlock | ImageContentBlock> };

export function inboundToUserMessage(
  body: string,
  media?: InboundMedia[],
): UserMessage {
  const text = body.trim() || (media?.length ? "[image attached]" : "");
  if (!media || media.length === 0) {
    return { role: "user", content: text };
  }
  const hasImage = media.some((m) => m.type === "image");
  if (!hasImage) {
    // Fall back to the legacy text-form so non-image attachments still
    // surface as paths the LLM can Read.
    return { role: "user", content: inboundToPrompt(text, media) };
  }
  const blocks: Array<TextContentBlock | ImageContentBlock> = [
    { type: "text", text },
  ];
  for (const m of media) {
    if (m.type === "image") {
      blocks.push({
        type: "image",
        source: {
          kind: "path",
          path: m.path,
          mimeType: m.mimeType ?? "image/png",
        },
      });
    } else {
      // Co-locate non-image media in the text block (e.g. a PDF next to
      // a screenshot). Path is preserved for the LLM to follow.
      blocks.push({ type: "text", text: `[file: ${m.path}]` });
    }
  }
  return { role: "user", content: blocks };
}
