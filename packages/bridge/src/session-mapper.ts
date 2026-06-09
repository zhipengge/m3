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

/**
 * Coalesce interval for `SessionMapper` writes. The mapper is hit
 * on every `setClaudeSessionId` (one per turn) and every inbound
 * `upsert` — a hot session can produce 5–20 writes/minute. A
 * 500ms debounce collapses a burst into a single fsync; on the
 * trailing edge, we still always write within `2×` the interval
 * so a slow trickle doesn't get starved. The 500ms figure matches
 * what the harness's snapshot store uses elsewhere — same
 * pattern, same number.
 */
const DEBOUNCE_MS = 500;

export class SessionMapper {
  private data: StoreData = { mappings: {} };
  /**
   * Pending write state. `dirty` is true when the in-memory map
   * has changes not yet on disk. `timer` is the trailing-edge
   * timer (null when there's nothing to flush). `lastFlushAt`
   * is a watchdog timestamp — even with a continuous write
   * trickle, we force a flush every FORCE_FLUSH_MS so a partial
   * update doesn't sit in memory forever if the process gets
   * SIGKILLed mid-burst.
   */
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private static readonly FORCE_FLUSH_MS = 5_000;

  constructor(private readonly dbPath: string) {
    this.load();
    // Watchdog: a 1s tick that force-flushes if the debounce
    // timer hasn't fired in FORCE_FLUSH_MS. The tick is cheap
    // (one number compare) and a no-op when nothing is dirty.
    // Without it, a continuous-write session that updates faster
    // than 2× the debounce window could theoretically starve the
    // trailing-edge timer; the watchdog closes that hole.
    this.watchdog = setInterval(() => {
      if (!this.dirty) return;
      if (Date.now() - this.lastFlushAt < SessionMapper.FORCE_FLUSH_MS) return;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.persist();
    }, 1_000);
    // Don't keep the event loop alive just for the watchdog —
    // the gateway has its own lifecycle, and a tick on an
    // otherwise-quiescent process is wasteful.
    if (typeof this.watchdog.unref === "function") this.watchdog.unref();
  }

  private load(): void {
    const resolved = expandHome(this.dbPath);
    if (!fs.existsSync(resolved)) return;
    try {
      this.data = JSON.parse(fs.readFileSync(resolved, "utf8")) as StoreData;
    } catch {
      this.data = { mappings: {} };
    }
    this.lastFlushAt = Date.now();
  }

  /**
   * Write the in-memory map to disk. Idempotent; safe to call
   * from the debounce timer, the watchdog, or a public `flush()`.
   * Errors are written to stderr but not thrown — losing a
   * session-mapping write should never crash the gateway.
   */
  private persist(): void {
    const resolved = expandHome(this.dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    try {
      fs.writeFileSync(resolved, JSON.stringify(this.data, null, 2));
      this.dirty = false;
      this.lastFlushAt = Date.now();
    } catch (err) {
      process.stderr.write(
        `[m3:session-mapper] persist failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  /**
   * Schedule a coalesced write. Called after every mutating
   * operation. Sets `dirty` so the watchdog / `flush()` can
   * detect a never-flushed burst.
   */
  private schedulePersist(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.persist();
    }, DEBOUNCE_MS);
  }

  /**
   * Force a synchronous flush. Called on gateway shutdown so a
   * SIGTERM doesn't lose the last few in-flight updates. Safe
   * to call when nothing is dirty. Also stops the watchdog
   * so it doesn't fire after the gateway is supposed to be
   * quiescent.
   */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    if (this.dirty) this.persist();
  }

  get(sessionKey: string): SessionMapping | undefined {
    return this.data.mappings[sessionKey];
  }

  upsert(mapping: SessionMapping): void {
    this.data.mappings[mapping.sessionKey] = {
      ...mapping,
      updatedAt: new Date().toISOString(),
    };
    this.schedulePersist();
  }

  setClaudeSessionId(sessionKey: string, claudeSessionId: string): void {
    const existing = this.data.mappings[sessionKey];
    if (!existing) return;
    existing.claudeSessionId = claudeSessionId;
    existing.updatedAt = new Date().toISOString();
    this.schedulePersist();
  }

  list(): SessionMapping[] {
    return Object.values(this.data.mappings);
  }

  remove(sessionKey: string): boolean {
    if (!this.data.mappings[sessionKey]) return false;
    delete this.data.mappings[sessionKey];
    this.schedulePersist();
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
