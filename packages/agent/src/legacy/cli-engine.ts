import { spawn } from "node:child_process";
import type { AgentConfig } from "@m3/config";
import type { AgentEngine, AgentRunOptions, AgentRunResult, AgentStreamEvent } from "../types.js";

/** @deprecated Legacy CLI subprocess backend — use native engine instead. */
export class LegacyCliEngine implements AgentEngine {
  readonly id = "legacy-cli";

  constructor(private readonly config: AgentConfig) {}

  async *run(options: AgentRunOptions): AsyncGenerator<AgentStreamEvent, AgentRunResult> {
    const events: AgentStreamEvent[] = [];
    const cmd = this.config.legacyCliCommand;
    const args = ["-p", "--output-format", "stream-json", options.prompt];

    yield { type: "lifecycle", phase: "start" };

    const child = spawn(cmd, args, { cwd: options.cwd ?? this.config.cwd ?? process.cwd(), shell: false });
    let finalText = "";
    let buffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (obj.type === "result" && typeof obj.result === "string") finalText = obj.result;
        } catch {
          // skip
        }
      }
    });

    const code = await new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? 1)));
    if (code !== 0 && !finalText) {
      yield { type: "lifecycle", phase: "error", error: `exit ${code}` };
      return { text: "", events };
    }

    yield { type: "assistant_message", text: finalText };
    yield { type: "lifecycle", phase: "end" };
    const result: AgentStreamEvent = { type: "result", text: finalText, sessionId: options.sessionId };
    yield result;
    return { text: finalText, sessionId: options.sessionId, events: [...events, result] };
  }
}

export function createLegacyCliEngine(config: AgentConfig): AgentEngine {
  return new LegacyCliEngine(config);
}
