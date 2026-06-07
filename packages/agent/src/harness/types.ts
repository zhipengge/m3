import type { AgentConfig, ResolvedModel } from "@m3/config";
import type { PermissionHandler } from "../permissions/manager.js";
import type { SandboxPolicy } from "../security/workspace.js";

/** Tool execution context — migrated from CC ToolUseContext (minimal subset). */
export type ToolContext = {
  cwd: string;
  sessionId: string;
  permissionMode: AgentConfig["permissionMode"];
  abortSignal?: AbortSignal;
  planMode: boolean;
  /** Workspace sandbox policy for file/command tools. */
  sandbox: SandboxPolicy;
  /** Extra env var names exposed to Bash child processes. */
  bashEnvAllow?: string[];
};

export type ToolResult = {
  content: string;
  isError?: boolean;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  isReadOnly?: boolean;
  isConcurrencySafe?: boolean;
  needsPermission?: boolean;
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
};

export type AnthropicToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

export type HarnessMessage =
  | { role: "user"; content: string | ContentBlock[] }
  | { role: "assistant"; content: string | ContentBlock[] };

/**
 * Where the image bytes live. Path mode is preferred for terminal paste and
 * channel media: bytes are persisted to ~/.m3/media/<channel>/<account>/ and
 * only the path is shipped in the user message — providers base64-encode at
 * send time. Base64 mode is reserved for future use (e.g. ephemeral paste,
 * network-only paths).
 */
export type ImageSource =
  | { kind: "path"; path: string; mimeType: string }
  | { kind: "base64"; data: string; mimeType: string };

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: ImageSource }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export type HarnessEvent =
  | { type: "assistant_delta"; delta: string }
  | { type: "reasoning_delta"; delta: string }
  | { type: "assistant_message"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; output: string; isError?: boolean }
  | { type: "session_id"; sessionId: string }
  | { type: "lifecycle"; phase: "start" | "end" | "error"; error?: string }
  | { type: "context_compressed"; keptMessages: number; summarizedTurns: number }
  | { type: "turn_complete"; turn: number }
  | {
      type: "token_usage";
      turn: number;
      input: number;
      output: number;
      cacheRead?: number;
      cacheCreation?: number;
      total: number;
      /** Per-turn USD cost (omitted when no pricing configured). */
      costUsd?: number;
      /** Running total across the whole session (so consumers don't
       * need to accumulate themselves). Reset on /clear. */
      cumulative: { input: number; output: number; total: number; costUsd?: number };
    };

export type QueryLoopOptions = {
  prompt: string;
  sessionId: string;
  cwd: string;
  model: ResolvedModel;
  tools: ToolDefinition[];
  permissionMode: AgentConfig["permissionMode"];
  planMode: boolean;
  maxTurns: number;
  abortSignal?: AbortSignal;
  resumeMessages?: HarnessMessage[];
  /** Workspace sandbox policy passed through to tool execution. */
  sandbox: SandboxPolicy;
  /** Extra env var names exposed to Bash child processes. */
  bashEnvAllow?: string[];
  /** Additional system-prompt text (e.g. skill catalog). */
  extraSystem?: string;
  /** Optional approval hook (e.g. gateway PermissionBridge). */
  permissionHandler?: PermissionHandler;
  /**
   * Optional image attachments for the FIRST user turn. When present and
   * the prompt is non-empty, the first message is upgraded from a string
   * to `ContentBlock[]` with one text + one image block per attachment.
   */
  attachments?: Array<{ type: "image" | "file"; path: string; mimeType?: string }>;
};

export type QueryLoopResult = {
  text: string;
  sessionId: string;
  messages: HarnessMessage[];
  turns: number;
};

export function toolToAnthropicDef(tool: ToolDefinition): AnthropicToolDef {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: tool.inputSchema.properties,
      required: tool.inputSchema.required,
    },
  };
}

export function extractTextFromContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}
