import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ContentBlock, HarnessMessage } from "../harness/types.js";
import { resolveImageSource } from "../harness/image-source.js";
import { httpAgentForUrl, LLM_HTTP_TIMEOUT_MS } from "./http-agent.js";
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

    const idleMs = 120_000;
    let lastChunkAt = Date.now();

    for await (const chunk of stream) {
      if (params.abortSignal?.aborted) break;
      if (Date.now() - lastChunkAt > idleMs) {
        throw new Error(
          `LLM stream idle timeout (${idleMs / 1000}s without data). Try again or use a faster model.`,
        );
      }
      const choice = chunk.choices[0];
      if (!choice) continue;
      lastChunkAt = Date.now();

      if (choice.finish_reason === "stop") break;

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
    };
  }
}
