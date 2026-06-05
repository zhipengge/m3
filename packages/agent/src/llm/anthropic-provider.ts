import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import type { ContentBlock, HarnessMessage } from "../harness/types.js";
import { resolveImageSource } from "../harness/image-source.js";
import type { LlmProvider, LlmStreamCallbacks, LlmTurnParams, LlmTurnResult } from "./types.js";

/** MIME types Anthropic accepts in the `image.source.media_type` field. */
const ANTHROPIC_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

async function toApiMessages(messages: HarnessMessage[]): Promise<MessageParam[]> {
  const out: MessageParam[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content } as MessageParam);
      continue;
    }
    const parts: NonNullable<MessageParam["content"]> = [];
    for (const block of m.content) {
      if (block.type === "text") {
        const existing = parts.find(
          (p): p is { type: "text"; text: string } => typeof p === "object" && "type" in p && p.type === "text",
        );
        if (existing) existing.text += block.text;
        else parts.push({ type: "text", text: block.text });
        continue;
      }
      if (block.type === "image") {
        const { data, mimeType } = await resolveImageSource(block.source);
        // Anthropic only supports the four standard image MIMEs; for
        // anything else (e.g. a clipboard BMP) we surface an inline error
        // block rather than silently dropping the image.
        if (!ANTHROPIC_IMAGE_MIME.has(mimeType)) {
          parts.push({
            type: "text",
            text: `[image: unsupported MIME ${mimeType}; Anthropic only accepts png/jpeg/gif/webp]`,
          });
          continue;
        }
        // NOTE: Anthropic's `data` field is raw base64, NOT a `data:` URI
        // (OpenAI's is the opposite). Easy to confuse.
        parts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            data,
          },
        });
        continue;
      }
      if (block.type === "tool_use") {
        parts.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
        continue;
      }
      // tool_result
      parts.push({
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: block.content,
        is_error: block.is_error,
      });
    }
    out.push({ role: m.role, content: parts } as MessageParam);
  }
  return out;
}

function mapStopReason(reason: string | null): LlmTurnResult["stopReason"] {
  if (reason === "end_turn") return "end_turn";
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  return reason ? "error" : null;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly id = "anthropic-messages";

  async completeTurn(params: LlmTurnParams, callbacks?: LlmStreamCallbacks): Promise<LlmTurnResult> {
    const client = new Anthropic({ apiKey: params.model.apiKey });
    const assistantContent: ContentBlock[] = [];
    let text = "";

    const stream = client.messages.stream({
      model: params.model.modelId,
      max_tokens: params.model.maxTokens,
      system: params.system,
      messages: await toApiMessages(params.messages),
      tools: params.tools.length > 0 ? params.tools : undefined,
    });

    if (params.abortSignal) {
      params.abortSignal.addEventListener("abort", () => stream.abort(), { once: true });
    }

    // Idle watchdog. The Anthropic SDK doesn't surface stream-level stalls
    // well, so we keep our own counter — if no event fires for
    // M3_LLM_IDLE_TIMEOUT_MS, abort the stream. Default 10 minutes
    // (matches the OpenAI provider).
    const idleMs = (() => {
      const raw = process.env.M3_LLM_IDLE_TIMEOUT_MS;
      if (raw && /^\d+$/.test(raw)) {
        const n = Number(raw);
        if (n >= 0) return n;
      }
      return 10 * 60 * 1000;
    })();
    let lastEventAt = Date.now();
    let watchdog: ReturnType<typeof setInterval> | null = null;
    if (idleMs > 0) {
      const bump = () => {
        lastEventAt = Date.now();
      };
      stream.on("text", bump);
      stream.on("contentBlock", bump);
      stream.on("message", bump);
      watchdog = setInterval(() => {
        if (Date.now() - lastEventAt > idleMs) {
          stream.abort();
        }
      }, Math.max(1000, Math.floor(idleMs / 10)));
    }

    try {
      stream.on("text", (delta) => {
        text += delta;
        callbacks?.onTextDelta?.(delta);
      });

      stream.on("contentBlock", (block) => {
        if (block.type === "tool_use") {
          assistantContent.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      });

      const final = await stream.finalMessage();
      if (text) assistantContent.unshift({ type: "text", text });

      // Anthropic returns a full Usage object on the final message
      // (input_tokens, output_tokens, cache_creation_input_tokens,
      // cache_read_input_tokens). Normalize into our shared TokenUsage.
      const u = final.usage;
      const usage = u
        ? {
            input: u.input_tokens ?? 0,
            output: u.output_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? undefined,
            cacheCreation: u.cache_creation_input_tokens ?? undefined,
            total:
              (u.input_tokens ?? 0) +
              (u.output_tokens ?? 0) +
              (u.cache_read_input_tokens ?? 0) +
              (u.cache_creation_input_tokens ?? 0),
          }
        : undefined;

      return {
        assistantContent,
        text,
        stopReason: mapStopReason(final.stop_reason),
        ...(usage ? { usage } : {}),
      };
    } catch (err) {
      // Re-throw as a more descriptive error so the TUI can show a useful
      // message instead of an opaque SDK exception.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("aborted") || msg.includes("abort")) {
        throw new Error(
          `Anthropic stream aborted (idle ${Math.round(idleMs / 1000)}s without an event). ` +
            `Set M3_LLM_IDLE_TIMEOUT_MS=0 to disable.`,
        );
      }
      throw err;
    } finally {
      if (watchdog) clearInterval(watchdog);
    }
  }
}
