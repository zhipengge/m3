import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ContentBlock, HarnessMessage } from "../harness/types.js";
import { resolveImageSource } from "../harness/image-source.js";
import { httpAgentForUrl, LLM_HTTP_TIMEOUT_MS } from "./http-agent.js";
import { createIdleWatchdog, readIdleTimeoutMs } from "./idle-watchdog.js";
import { extractOpenAiReasoningDelta, modelUsesReasoningSplit } from "./reasoning.js";
import type { LlmProvider, LlmStreamCallbacks, LlmTurnParams, LlmTurnResult } from "./types.js";

/**
 * Translate one `ContentBlock[]` user message into the OpenAI
 * `ChatCompletionContentPart[]` shape (text + image_url). The image source
 * is resolved (read from disk and base64-encoded) here, immediately before
 * the API call — not on inbound — so the on-disk path keeps the transcript
 * small and the resolved bytes never enter session persistence.
 */
async function buildUserContent(
  blocks: ContentBlock[],
): Promise<Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>> {
  const out: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [];
  for (const b of blocks) {
    if (b.type === "text") {
      out.push({ type: "text", text: b.text });
      continue;
    }
    if (b.type === "image") {
      const { data, mimeType } = await resolveImageSource(b.source);
      // OpenAI accepts a data: URI in image_url.url — that's the standard
      // path for local files. No file-path option exists.
      out.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${data}` },
      });
    }
    // tool_use / tool_result never appear in a user turn (those are
    // produced only by the assistant); safely ignored.
  }
  return out;
}

export async function buildOpenAiMessages(
  messages: HarnessMessage[],
  system?: string,
): Promise<ChatCompletionMessageParam[]> {
  const out: ChatCompletionMessageParam[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }

    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const toolUses = m.content.filter((b) => b.type === "tool_use");
      if (toolUses.length > 0) {
        out.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolUses.map((t) => ({
            id: t.id,
            type: "function",
            function: {
              name: t.name,
              arguments: JSON.stringify(t.input ?? {}),
            },
          })),
        });
      } else {
        out.push({ role: "assistant", content: text });
      }
      continue;
    }

    const toolResults = m.content.filter((b) => b.type === "tool_result");
    if (toolResults.length > 0) {
      for (const tr of toolResults) {
        out.push({
          role: "tool",
          tool_call_id: tr.tool_use_id,
          content: tr.content,
        });
      }
      continue;
    }

    // User turn: may contain image blocks — resolve them and pass a
    // multi-part content array to the API.
    const parts = await buildUserContent(m.content);
    if (parts.length === 1 && parts[0]!.type === "text") {
      // Preserve the plain string content for text-only messages so we
      // don't change the wire shape for the common case.
      out.push({ role: "user", content: parts[0]!.text });
    } else {
      out.push({ role: "user", content: parts });
    }
  }

  return out;
}

/** OpenAI-compatible chat provider — used for DeepSeek and similar APIs */
export class OpenAiChatProvider implements LlmProvider {
  readonly id = "openai-chat";

  async completeTurn(params: LlmTurnParams, callbacks?: LlmStreamCallbacks): Promise<LlmTurnResult> {
    const client = new OpenAI({
      apiKey: params.model.apiKey,
      baseURL: params.model.baseUrl,
      timeout: LLM_HTTP_TIMEOUT_MS,
      maxRetries: 2,
      httpAgent: httpAgentForUrl(params.model.baseUrl),
    });

    const tools =
      params.tools.length > 0
        ? params.tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
            },
          }))
        : undefined;

    const stream = await client.chat.completions.create({
      model: params.model.modelId,
      messages: await buildOpenAiMessages(params.messages, params.system),
      tools,
      max_tokens: params.model.maxTokens,
      stream: true,
      // OpenAI's protocol puts `usage` on a chunk whose choice has
      // `finish_reason: "stop"` (or no choice at all). With `include_usage`
      // the SDK adds a final usage-only chunk. The old code did an early
      // `break` on `finish_reason === "stop"` which discarded that final
      // chunk — now we let the stream run to its natural end and capture
      // `chunk.usage` from any chunk that carries it.
      stream_options: { include_usage: true },
      ...(modelUsesReasoningSplit(params.model.modelId)
        ? {
            extra_body: {
              reasoning_split: true,
              thinking: { type: "adaptive" },
            },
          }
        : {}),
    });

    let text = "";
    let reasoningCumulative = "";
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    let usage: { input: number; output: number; total?: number } | undefined;

    // Idle timeout watchdog. Shared with anthropic-provider via
    // idle-watchdog.ts. Previously each provider had its own copy of
    // the same setInterval block, which was a maintenance trap.
    const idleMs = readIdleTimeoutMs();
    let idleTimedOut = false;
    const idleWatchdog = createIdleWatchdog(idleMs, () => {
      idleTimedOut = true;
      // Force the stream to error so the for-await throws
      try {
        (stream as unknown as { controller?: { abort?: () => void } }).controller?.abort?.();
      } catch {
        /* ignore */
      }
    });

    try {
      for await (const chunk of stream) {
        if (params.abortSignal?.aborted) break;
        if (idleTimedOut) {
          throw new Error(
            `LLM stream idle timeout (${Math.round(idleMs / 1000)}s without data). ` +
              `Set M3_LLM_IDLE_TIMEOUT_MS=0 to disable, or use a faster model.`,
          );
        }
        idleWatchdog.bump();
        // Usage may arrive on the final chunk (a chunk with no choice, or
        // a choice with finish_reason === "stop") when stream_options
        // include_usage is set. Capture it from every chunk so we never
        // miss it regardless of which chunk the SDK picks.
        if (chunk.usage) {
          const total = chunk.usage.total_tokens ?? undefined;
          usage = {
            input: chunk.usage.prompt_tokens ?? 0,
            output: chunk.usage.completion_tokens ?? 0,
            ...(total !== undefined ? { total } : {}),
          };
        }
        const choice = chunk.choices[0];
        if (!choice) continue;

        // Don't break on `finish_reason === "stop"` — the stream may
        // still emit trailing usage-only chunks. Let the for-await
        // terminate naturally when the SDK closes the iterator.

        const rawDelta = choice.delta as Record<string, unknown>;
        const reasoning = extractOpenAiReasoningDelta(rawDelta, reasoningCumulative);
        if (reasoning) {
          reasoningCumulative = reasoning.cumulative;
          if (reasoning.delta) callbacks?.onReasoningDelta?.(reasoning.delta);
        }

        if (choice.delta.content) {
          text += choice.delta.content;
          callbacks?.onTextDelta?.(choice.delta.content);
        }

        for (const tc of choice.delta.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          if (!toolCalls.has(idx)) {
            toolCalls.set(idx, { id: tc.id ?? `call_${idx}`, name: "", args: "" });
          }
          const entry = toolCalls.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
        }
      }
    } finally {
      idleWatchdog.stop();
    }

    const assistantContent: ContentBlock[] = [];
    if (text) assistantContent.push({ type: "text", text });

    for (const tc of toolCalls.values()) {
      if (!tc.name.trim()) continue;
      let input: unknown = {};
      try {
        input = tc.args ? JSON.parse(tc.args) : {};
      } catch {
        input = { raw: tc.args };
      }
      assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input });
    }

    return {
      assistantContent,
      text,
      stopReason: toolCalls.size > 0 ? "tool_use" : text ? "end_turn" : null,
      ...(usage
        ? {
            usage: {
              input: usage.input,
              output: usage.output,
              total: usage.total ?? usage.input + usage.output,
              ...(computeCostUsd(usage.input, usage.output, params.model.pricing)
                ? { costUsd: computeCostUsd(usage.input, usage.output, params.model.pricing)! }
                : {}),
            },
          }
        : {}),
    };
  }
}

/**
 * Cost = inputTokens × inputPrice / 1_000_000 + outputTokens × outputPrice / 1_000_000.
 * Returns undefined when pricing is missing (consumer renders `—`).
 */
function computeCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: { input: number; output: number } | undefined,
): number | undefined {
  if (!pricing) return undefined;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
