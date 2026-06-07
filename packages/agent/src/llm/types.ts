import type { ResolvedModel } from "@m3/config";
import type { AnthropicToolDef, ContentBlock, HarnessMessage } from "../harness/types.js";

export type LlmTurnParams = {
  model: ResolvedModel;
  messages: HarnessMessage[];
  tools: AnthropicToolDef[];
  system?: string;
  abortSignal?: AbortSignal;
};

/**
 * Per-turn token usage returned by the LLM provider. OpenAI splits into
 * prompt_tokens / completion_tokens; Anthropic adds cache_read /
 * cache_creation_input_tokens. We normalize to a single shape that the
 * harness, status bar, and `/cost` command can all consume uniformly.
 */
export type TokenUsage = {
  input: number;
  output: number;
  /** Tokens served from a provider-side cache (Anthropic prompt cache). */
  cacheRead?: number;
  /** Tokens written to the cache for the next turn. */
  cacheCreation?: number;
  /** Provider-reported total, or input+output when missing. */
  total: number;
  /**
   * USD cost for THIS turn, computed in the LLM provider from
   * `ResolvedModel.pricing`. Missing when the model has no pricing
   * configured (default behaviour: status bar shows `—`).
   */
  costUsd?: number;
};

export type LlmTurnResult = {
  assistantContent: ContentBlock[];
  text: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "error" | null;
  usage?: TokenUsage;
};

export type LlmStreamCallbacks = {
  onTextDelta?: (delta: string) => void;
  /** Model reasoning / thinking tokens (MiniMax reasoning_split, DeepSeek reasoner, etc.). */
  onReasoningDelta?: (delta: string) => void;
};

export interface LlmProvider {
  readonly id: string;
  completeTurn(params: LlmTurnParams, callbacks?: LlmStreamCallbacks): Promise<LlmTurnResult>;
}

export const DEFAULT_SYSTEM_PROMPT = `You are m3, an expert coding agent. You have tools to read, edit, write files, run shell commands, and search the codebase.
- Prefer small, focused changes.
- Run tests when appropriate.
- Explain briefly what you did.
- Create and edit files only under the workspace root given in the system message; do not use /tmp unless the user explicitly asks.`;
