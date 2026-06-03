import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ContentBlock, HarnessMessage } from "../harness/types.js";
import type { LlmProvider, LlmStreamCallbacks, LlmTurnParams, LlmTurnResult } from "./types.js";

export function buildOpenAiMessages(
  messages: HarnessMessage[],
  system?: string,
): ChatCompletionMessageParam[] {
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

    const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    out.push({ role: "user", content: text });
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
      messages: buildOpenAiMessages(params.messages, params.system),
      tools,
      max_tokens: params.model.maxTokens,
      stream: true,
    });

    let text = "";
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();

    const idleMs = 90_000;
    let lastChunkAt = Date.now();

    for await (const chunk of stream) {
      if (params.abortSignal?.aborted) break;
      if (Date.now() - lastChunkAt > idleMs) break;
      const choice = chunk.choices[0];
      if (!choice) continue;
      lastChunkAt = Date.now();

      if (choice.finish_reason === "stop") break;

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
