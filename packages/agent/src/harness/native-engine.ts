import type { AgentConfig, ResolvedModel } from "@m3/config";
import type { AgentEngine, AgentRunOptions, AgentRunResult, AgentStreamEvent } from "../types.js";
import { mapHarnessEvent } from "./event-mapper.js";
import { QueryEngine } from "./query-engine.js";

export type NativeEngineOptions = {
  agent: AgentConfig;
  model: ResolvedModel;
};

/** In-process m3 native harness — replaces Claude Code CLI subprocess. */
export class NativeAgentEngine implements AgentEngine {
  readonly id = "native";
  private readonly queryEngine: QueryEngine;

  constructor(options: NativeEngineOptions) {
    this.queryEngine = new QueryEngine(options);
  }

  async *run(options: AgentRunOptions): AsyncGenerator<AgentStreamEvent, AgentRunResult> {
    const events: AgentStreamEvent[] = [];
    const gen = this.queryEngine.submit({
      prompt: options.prompt,
      sessionId: options.sessionId,
      cwd: options.cwd,
      planMode: options.planMode,
      abortSignal: options.abortSignal,
      resume: options.resume,
      permissionMode: options.permissionMode,
      permissionHandler: options.permissionHandler,
    });

    let result = await gen.next();
    while (!result.done) {
      for (const mapped of mapHarnessEvent(result.value)) {
        events.push(mapped);
        yield mapped;
      }
      result = await gen.next();
    }

    const { text, sessionId } = result.value;
    const resultEvt: AgentStreamEvent = { type: "result", text, sessionId };
    events.push(resultEvt);
    yield resultEvt;

    return { text, sessionId, events };
  }
}

export function createNativeEngine(options: NativeEngineOptions): AgentEngine {
  return new NativeAgentEngine(options);
}
