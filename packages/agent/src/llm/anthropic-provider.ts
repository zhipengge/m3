import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import type { ContentBlock, HarnessMessage } from "../harness/types.js";
import type { LlmProvider, LlmStreamCallbacks, LlmTurnParams, LlmTurnResult } from "./types.js";

function toApiMessages(messages: HarnessMessage[]): MessageParam[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content } as MessageParam;
    }
    return {
      role: m.role,
      content: m.content.map((block) => {
        if (block.type === "text") return { type: "text" as const, text: block.text };
        if (block.type === "tool_use") {
          return {
            type: "tool_use" as const,
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          };
        }
        return {
          type: "tool_result" as const,
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error,
        };
      }),
    } as MessageParam;
  });
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
      messages: toApiMessages(params.messages),
      tools: params.tools.length > 0 ? params.tools : undefined,
    });

    if (params.abortSignal) {
      params.abortSignal.addEventListener("abort", () => stream.abort(), { once: true });
    }

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

    return {
      assistantContent,
      text,
      stopReason: mapStopReason(final.stop_reason),
    };
  }
}
