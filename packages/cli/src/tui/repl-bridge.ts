export type ReplPermissionRequest = {
  toolName: string;
  description: string;
};

export type ReplPermissionDecision = "allow" | "deny" | "allow_session";

/** Per-turn + cumulative token usage from the LLM provider. */
export type ReplTokenUsage = {
  /** This turn's input / output / total. */
  input: number;
  output: number;
  total: number;
  cacheRead?: number;
  cacheCreation?: number;
  /** Running totals for the whole session — the StatusBar reads these
   *  to show "tok 12.4k (↑8.2k ↓4.2k)". The cost cap enforcement
   *  in repl-app.tsx reads cumulative.costUsd against the configured
   *  agent.costCapUsd. */
  cumulative: { input: number; output: number; total: number; costUsd?: number };
};

/** Bridges gateway webchat callbacks into the Ink REPL (no global state). */
export type ReplUiSink = {
  onTyping: () => void;
  onDelta: (delta: string) => void;
  onReasoningDelta: (delta: string) => void;
  onDeliver: (text: string) => void;
  onSystem: (text: string) => void;
  /** Interactive tool approval (Ink); resolves when user presses y/n. */
  requestPermission?: (req: ReplPermissionRequest) => Promise<ReplPermissionDecision>;
  /** Per-turn token usage; cumulative is the running session total. */
  onTokens?: (usage: ReplTokenUsage) => void;
  /** Tool invocation just started — surface a "▸ Read foo.ts" line and
   *  capture a start timestamp so onToolResult can compute duration. */
  onToolUse?: (info: { id: string; name: string; input: unknown }) => void;
  /** Tool invocation finished — push into the recent-tools timeline
   *  and surface the output in the message stream. `output` may be
   *  truncated to a few KB by the bridge pipeline; for verbose tools
   *  the user can read the full text in the transcript. */
  onToolResult?: (info: {
    id: string;
    name: string;
    isError?: boolean;
    output?: string;
  }) => void;
};

let activeSink: ReplUiSink | null = null;

export function setReplUiSink(sink: ReplUiSink | null): void {
  activeSink = sink;
}

export function getReplUiSink(): ReplUiSink | null {
  return activeSink;
}
