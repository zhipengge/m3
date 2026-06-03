import { getLlmProvider } from "../llm/router.js";
import { DEFAULT_SYSTEM_PROMPT } from "../llm/types.js";
import { PermissionManager } from "../permissions/manager.js";
import { executeTools } from "./tool-orchestration.js";
import type {
  ContentBlock,
  HarnessEvent,
  HarnessMessage,
  QueryLoopOptions,
  QueryLoopResult,
} from "./types.js";
import { toolToAnthropicDef } from "./types.js";

/** Core agent loop — migrated from CC query.ts queryLoop (simplified). */
export async function* runQueryLoop(
  options: QueryLoopOptions,
): AsyncGenerator<HarnessEvent, QueryLoopResult> {
  const permissions = new PermissionManager(options.permissionMode);
  if (options.permissionHandler) {
    permissions.setHandler(options.permissionHandler);
  }
  const tools = options.tools;
  const sessionId = options.sessionId;
  const messages: HarnessMessage[] = options.resumeMessages ? [...options.resumeMessages] : [];
  messages.push({ role: "user", content: options.prompt });

  yield { type: "session_id", sessionId };
  yield { type: "lifecycle", phase: "start" };

  let finalText = "";
  let turns = 0;
  const llm = getLlmProvider(options.model.api);

  const toolCtx = {
    cwd: options.cwd,
    sessionId,
    permissionMode: options.permissionMode,
    abortSignal: options.abortSignal,
    planMode: options.planMode,
    sandbox: options.sandbox,
    bashEnvAllow: options.bashEnvAllow,
  };

  const base = options.planMode
    ? `${DEFAULT_SYSTEM_PROMPT}\n\nYou are in PLAN MODE. Do not modify files or run destructive commands. Propose a plan only.`
    : DEFAULT_SYSTEM_PROMPT;
  const system = options.extraSystem ? `${base}\n\n${options.extraSystem}` : base;

  while (turns < options.maxTurns) {
    if (options.abortSignal?.aborted) {
      yield { type: "lifecycle", phase: "error", error: "aborted" };
      break;
    }

    turns++;

    const turn = await llm.completeTurn(
      {
        model: options.model,
        messages,
        tools: tools.map(toolToAnthropicDef),
        system,
        abortSignal: options.abortSignal,
      },
      {
        onTextDelta: (delta: string) => {
          finalText += delta;
        },
      },
    );

    if (turn.text) {
      yield { type: "assistant_delta", delta: turn.text };
    }

    messages.push({ role: "assistant", content: turn.assistantContent });

    const toolUses = turn.assistantContent.filter(
      (b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use",
    );

    if (toolUses.length === 0 || turn.stopReason === "end_turn") {
      finalText = turn.text || finalText;
      yield { type: "assistant_message", text: finalText };
      yield { type: "turn_complete", turn: turns };
      break;
    }

    const toolResults: ContentBlock[] = [];
    for await (const evt of executeTools(
      toolUses.map((t) => ({ id: t.id, name: t.name, input: t.input, type: "tool_use" as const })),
      tools,
      toolCtx,
      permissions,
    )) {
      yield evt;
      if (evt.type === "tool_result") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: evt.id,
          content: evt.output,
          is_error: evt.isError,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
    yield { type: "turn_complete", turn: turns };

    if (turn.stopReason !== "tool_use") {
      finalText = turn.text || finalText;
      yield { type: "assistant_message", text: finalText };
      break;
    }
  }

  yield { type: "lifecycle", phase: "end" };
  return { text: finalText, sessionId, messages, turns };
}
