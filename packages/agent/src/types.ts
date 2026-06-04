import type { AgentConfig } from "@m3/config";
import type { PermissionHandler } from "./permissions/manager.js";

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
};

export type AgentStreamEvent =
  | { type: "assistant_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "assistant_message"; text: string }
  | { type: "tool_use"; name: string; input?: unknown }
  | { type: "tool_result"; name: string; output?: string }
  | { type: "session_id"; sessionId: string }
  | { type: "lifecycle"; phase: "start" | "end" | "error"; error?: string }
  | { type: "context_compressed"; keptMessages: number; summarizedTurns: number }
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
