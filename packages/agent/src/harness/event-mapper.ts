import type { AgentStreamEvent } from "../types.js";
import type { HarnessEvent } from "./types.js";

export function mapHarnessEvent(evt: HarnessEvent): AgentStreamEvent[] {
  switch (evt.type) {
    case "assistant_delta":
      return [{ type: "assistant_delta", delta: evt.delta }];
    case "assistant_message":
      return [{ type: "assistant_message", text: evt.text }];
    case "tool_use":
      return [{ type: "tool_use", name: evt.name, input: evt.input }];
    case "tool_result":
      return [{ type: "tool_result", name: evt.name, output: evt.output }];
    case "session_id":
      return [{ type: "session_id", sessionId: evt.sessionId }];
    case "lifecycle":
      return [{ type: "lifecycle", phase: evt.phase, error: evt.error }];
    case "turn_complete":
      return [];
    default:
      return [];
  }
}
