import { prepareMessagesForContext } from "../context-trim.js";
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

class StreamWake extends Error {
  readonly tag = "stream-wake";
}

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
  // Build the first user turn — string when there are no attachments, or
  // a `ContentBlock[]` when at least one image is attached. Non-image
  // attachments stay in the text body as path references.
  const hasImageAttachment = options.attachments?.some((m) => m.type === "image");
  if (hasImageAttachment) {
    const blocks: ContentBlock[] = [{ type: "text", text: options.prompt || "[image attached]" }];
    for (const m of options.attachments ?? []) {
      if (m.type === "image") {
        blocks.push({
          type: "image",
          source: {
            kind: "path",
            path: m.path,
            mimeType: m.mimeType ?? "image/png",
          },
        });
      } else {
        blocks.push({ type: "text", text: `[file: ${m.path}]` });
      }
    }
    messages.push({ role: "user", content: blocks });
  } else {
    messages.push({ role: "user", content: options.prompt });
  }

  yield { type: "session_id", sessionId };
  yield { type: "lifecycle", phase: "start" };

  let finalText = "";
  let turns = 0;
  // Running session-level token totals. The harness has no notion of a
  // session boundary so the loop just accumulates; the bridge layer
  // resets this on /clear.
  const sessionTokens = { input: 0, output: 0, total: 0, costUsd: 0 };
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

  const workspaceBlock = `## Workspace\nRoot: ${options.cwd}\nUse workspace-relative paths for Read/Write/Edit/Glob/Bash.`;
  const base = options.planMode
    ? `${DEFAULT_SYSTEM_PROMPT}\n\nYou are in PLAN MODE. Do not modify files or run destructive commands. Propose a plan only.`
    : DEFAULT_SYSTEM_PROMPT;
  const system = options.extraSystem
    ? `${base}\n\n${workspaceBlock}\n\n${options.extraSystem}`
    : `${base}\n\n${workspaceBlock}`;
  const toolDefs = tools.map(toolToAnthropicDef);
  const toolsJsonLength = JSON.stringify(toolDefs).length;

  while (turns < options.maxTurns) {
    if (options.abortSignal?.aborted) {
      yield { type: "lifecycle", phase: "error", error: "aborted" };
      break;
    }

    turns++;

    const prepared = prepareMessagesForContext({
      messages,
      maxContextTokens: options.model.maxContextTokens,
      maxOutputTokens: options.model.maxTokens,
      system,
      toolsJsonLength,
    });
    if (prepared.compressed) {
      messages.splice(0, messages.length, ...prepared.sessionMessages);
      yield {
        type: "context_compressed",
        keptMessages: prepared.sessionMessages.length,
        summarizedTurns: prepared.summarizedTurns,
      };
    }
    const apiMessages = prepared.apiMessages;

    const pending: HarnessEvent[] = [];
    let streamWake: (() => void) | undefined;
    const signalStream = () => streamWake?.();

    let streamedText = false;
    const turnPromise = llm.completeTurn(
      {
        model: options.model,
        messages: apiMessages,
        tools: toolDefs,
        system,
        abortSignal: options.abortSignal,
      },
      {
        onTextDelta: (delta: string) => {
          finalText += delta;
          streamedText = true;
          pending.push({ type: "assistant_delta", delta });
          signalStream();
        },
        onReasoningDelta: (delta: string) => {
          pending.push({ type: "reasoning_delta", delta });
          signalStream();
        },
      },
    );

    let turn: Awaited<typeof turnPromise>;
    while (true) {
      while (pending.length > 0) {
        yield pending.shift()!;
      }
      try {
        turn = await Promise.race([
          turnPromise,
          new Promise<never>((_, reject) => {
            streamWake = () => reject(new StreamWake());
          }),
        ]);
        break;
      } catch (e) {
        if (e instanceof StreamWake) continue;
        throw e;
      }
    }
    while (pending.length > 0) yield pending.shift()!;

    if (turn.text && !streamedText) {
      yield { type: "assistant_delta", delta: turn.text };
    }

    messages.push({ role: "assistant", content: turn.assistantContent });

    // Emit a token_usage event for every turn that the provider reported
    // a usage object. Not all providers return one (e.g. legacy mock
    // engine), so the event is conditional.
    if (turn.usage) {
      sessionTokens.input += turn.usage.input;
      sessionTokens.output += turn.usage.output;
      sessionTokens.total += turn.usage.total;
      if (turn.usage.costUsd !== undefined) {
        sessionTokens.costUsd += turn.usage.costUsd;
      }
      const u = turn.usage;
      yield {
        type: "token_usage",
        turn: turns,
        input: u.input,
        output: u.output,
        ...(u.cacheRead !== undefined ? { cacheRead: u.cacheRead } : {}),
        ...(u.cacheCreation !== undefined ? { cacheCreation: u.cacheCreation } : {}),
        total: u.total,
        ...(u.costUsd !== undefined ? { costUsd: u.costUsd } : {}),
        cumulative: { ...sessionTokens },
      };
    }

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

// The generator body is the canonical implementation; the wrapper below
// is the public surface that callers (NativeAgentEngine, mock engine)
// actually consume. It catches errors thrown by the underlying provider
// and translates them into a `lifecycle: error` event so the TUI / bridge
// can surface them — without the wrapper, a thrown error propagates out
// of the async generator and the spinner hangs forever (the caller has
// no chance to render a failure message).
export async function* runQueryLoopSafe(
  options: QueryLoopOptions,
): AsyncGenerator<HarnessEvent, QueryLoopResult | undefined> {
  let result: QueryLoopResult | undefined;
  try {
    for await (const [evt, r] of (async function* () {
      // Forward every event AND capture the final return value in one
      // pass so callers (QueryEngine) can still persist the transcript.
      // This is a small inline helper rather than a re-implementation of
      // runQueryLoop so the two implementations can't drift.
      const inner = runQueryLoop(options);
      let next = await inner.next();
      while (!next.done) {
        yield [next.value, undefined] as const;
        next = await inner.next();
      }
      yield [undefined, next.value] as const;
    })()) {
      if (evt !== undefined) yield evt;
      if (r !== undefined) result = r;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: "lifecycle", phase: "error", error: message };
    // Re-throw so the engine.run generator also surfaces the error to
    // its caller (e.g. the bridge pipeline). The TUI gets BOTH a visible
    // system message (from the yield above) and a normal exception
    // path it can react to.
    throw err;
  }
  return result;
}
