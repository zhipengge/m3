import type { AgentEngine, AgentRunOptions, AgentRunResult, AgentStreamEvent } from "./types.js";

/** Mock engine for tests and offline E2E without Claude API. */
export class MockAgentEngine implements AgentEngine {
  readonly id = "mock";

  constructor(private readonly responder?: (prompt: string) => string) {}

  async *run(options: AgentRunOptions): AsyncGenerator<AgentStreamEvent, AgentRunResult> {
    const events: AgentStreamEvent[] = [];
    yield { type: "lifecycle", phase: "start" };
    events.push({ type: "lifecycle", phase: "start" });

    const sessionId = options.sessionId ?? `mock-${Date.now()}`;
    yield { type: "session_id", sessionId };
    events.push({ type: "session_id", sessionId });

    const text =
      this.responder?.(options.prompt) ??
      `[mock] Received: ${options.prompt.slice(0, 200)}`;

    yield { type: "assistant_delta", delta: text };
    events.push({ type: "assistant_delta", delta: text });

    yield { type: "assistant_message", text };
    events.push({ type: "assistant_message", text });

    yield { type: "lifecycle", phase: "end" };
    events.push({ type: "lifecycle", phase: "end" });

    yield { type: "result", text, sessionId };
    events.push({ type: "result", text, sessionId });

    return { text, sessionId, events };
  }
}

export function createMockEngine(responder?: (prompt: string) => string): AgentEngine {
  return new MockAgentEngine(responder);
}
