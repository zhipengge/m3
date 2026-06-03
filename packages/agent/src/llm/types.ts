import type { ResolvedModel } from "@m3/config";
import type { AnthropicToolDef, ContentBlock, HarnessMessage } from "../harness/types.js";

export type LlmTurnParams = {
  model: ResolvedModel;
  messages: HarnessMessage[];
  tools: AnthropicToolDef[];
  system?: string;
  abortSignal?: AbortSignal;
};

export type LlmTurnResult = {
  assistantContent: ContentBlock[];
  text: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "error" | null;
};

export type LlmStreamCallbacks = {
  onTextDelta?: (delta: string) => void;
};

export interface LlmProvider {
  readonly id: string;
  completeTurn(params: LlmTurnParams, callbacks?: LlmStreamCallbacks): Promise<LlmTurnResult>;
}

export const DEFAULT_SYSTEM_PROMPT = `You are m3, an expert coding agent. You have tools to read, edit, write files, run shell commands, and search the codebase.
- Prefer small, focused changes.
- Run tests when appropriate.
- Explain briefly what you did.`;
