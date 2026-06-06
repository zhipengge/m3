import type { AgentConfig } from "@m3/config";
import type { PermissionHandler } from "./permissions/manager.js";

/**
 * Inbound media attached to a user turn. Image media is inlined as a vision
 * block in the user message; non-image media keeps the legacy path-as-text
 * behaviour (the LLM is told the path and expected to Read it).
 *
 * Path is on disk in `~/.m3/media/<channel>/<account>/…` — providers
 * base64-encode it at send time, not at inbound time, so the transcript
 * stays small.
 */
export type InboundMedia = {
  type: "image" | "file";
  path: string;
  mimeType?: string;
};

export type AgentRunOptions = {
  prompt: string;
  sessionId?: string;
  cwd?: string;
  permissionMode?: AgentConfig["permissionMode"];
  model?: string;
  planMode?: boolean;
  resume?: boolean;
  abortSignal?: AbortSignal;
  permissionHandler?: PermissionHandler;
  /**
   * Optional attachments (e.g. terminal-pasted clipboard images, channel
   * downloads). When present and the user message is text-only, the bridge
   * layer promotes image media into a `ContentBlock[]` user message.
   */
  attachments?: InboundMedia[];
};

export type AgentStreamEvent =
  | { type: "assistant_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "assistant_message"; text: string }
  | { type: "tool_use"; id: string; name: string; input?: unknown }
  | { type: "tool_result"; id: string; name: string; output?: string; isError?: boolean }
  | { type: "session_id"; sessionId: string }
  | { type: "lifecycle"; phase: "start" | "end" | "error"; error?: string }
  | { type: "context_compressed"; keptMessages: number; summarizedTurns: number }
  | {
      type: "token_usage";
      turn: number;
      input: number;
      output: number;
      cacheRead?: number;
      cacheCreation?: number;
      total: number;
      cumulative: { input: number; output: number; total: number };
    }
  | { type: "result"; text: string; sessionId?: string; usage?: Record<string, number> };

export type AgentRunResult = {
  text: string;
  sessionId?: string;
  events: AgentStreamEvent[];
};

export interface AgentEngine {
  readonly id: string;
  run(options: AgentRunOptions): AsyncGenerator<AgentStreamEvent, AgentRunResult>;
}

export type SubAgentSpawnOptions = {
  prompt: string;
  agentType?: string;
  parentSessionId?: string;
  cwd?: string;
};

export type PlanModeOptions = {
  enabled: boolean;
  sessionId?: string;
};

export type McpBridgeOptions = {
  configPath?: string;
  gatewayTools?: boolean;
  token?: string;
};
