import type { AgentStreamEvent } from "@m3/agent";
import type { ReplyDispatcher } from "@m3/channels";

export type StreamAdapterOptions = {
  verboseTools?: boolean;
  chunkSize?: number;
  onAssistantDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  onSystemNotice?: (text: string) => void;
  onTokens?: (usage: {
    input: number;
    output: number;
    total: number;
    cacheRead?: number;
    cacheCreation?: number;
    cumulative: { input: number; output: number; total: number };
  }) => void;
  onContextCompressed?: (info: { keptMessages: number; summarizedTurns: number }) => void;
  onToolUse?: (info: { id: string; name: string; input: unknown }) => void;
  onToolResult?: (info: {
    id: string;
    name: string;
    isError?: boolean;
    output?: string;
  }) => void;
};

/**
 * Per-platform character limits for outbound messages. The dispatcher
 * picks a sensible default for the channel at construction; per-channel
 * adapters can override via `chunkSize`. We hard-code Slack and
 * Discord here so the bridge doesn't have to import them (that would
 * create a cycles-feeling dep graph); the channel manager is the
 * right place to wire platform-specific limits.
 */
const DEFAULT_CHUNK_SIZE = 4000;

export class StreamAdapter {
  private buffer = "";
  /**
   * Coalesce per-delta dispatcher writes to avoid one IPC per token. Slack
   * and Feishu can both be slow per-call (network round-trip + JSON
   * parse on the SDK side), and a fast-reasoning model can emit hundreds
   * of deltas per second. The bridge layer was previously forwarding
   * every delta to `dispatcher.startTyping` / per-channel onDelta, which
   * surfaced as visible "stall" jitter in the channel UI. We now buffer
   * and flush at ~50ms or on end-of-stream.
   */
  private deltaBuffer = "";
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private onAssistantDelta?: (delta: string) => void;

  constructor(
    private readonly dispatcher: ReplyDispatcher,
    private readonly options: StreamAdapterOptions = {},
  ) {
    this.onAssistantDelta = options.onAssistantDelta;
  }

  async handleEvent(event: AgentStreamEvent): Promise<void> {
    switch (event.type) {
      case "assistant_delta":
        this.buffer += event.delta;
        // Coalesce the listener callback (which fans out to webchat/feishu
        // / slack) into a 50ms batch — the consumer (TUI status, channel
        // typing indicator, etc.) only needs a high-frequency hint, not
        // every token.
        this.dispatcherDelta(event.delta);
        break;
      case "reasoning_delta":
        this.options.onReasoningDelta?.(event.delta);
        break;
      case "assistant_message":
        // Only overwrite the buffer if the harness never streamed — the
        // `assistant_delta` path already accumulated into `this.buffer`.
        // Reassigning blindly (the old behaviour) wiped any deltas the
        // channel-side listener had already received.
        if (this.buffer.length === 0) this.buffer = event.text;
        await this.flush();
        break;
      case "tool_use":
        // Flush any pending text so a tool call never gets prepended to
        // the assistant prose mid-stream.
        await this.flushDeltas();
        this.options.onToolUse?.({
          id: event.id,
          name: event.name,
          input: event.input,
        });
        if (this.options.verboseTools) {
          await this.dispatcher.deliver({ text: `(tool: ${event.name})` });
        }
        await this.dispatcher.startTyping?.();
        break;
      case "tool_result":
        this.options.onToolResult?.({
          id: event.id,
          name: event.name,
          isError: event.isError,
          output: event.output,
        });
        if (this.options.verboseTools && event.output) {
          await this.dispatcher.deliver({
            text: `(tool result: ${event.output.slice(0, 200)})`,
          });
        }
        break;
      case "lifecycle":
        if (event.phase === "start") {
          await this.dispatcher.startTyping?.();
        }
        if (event.phase === "end") {
          await this.flushDeltas();
          await this.flush();
        }
        break;
      case "context_compressed": {
        // Surface through the dedicated TUI handler so the activity
        // footer can render a `🗜 compressed N → M` toast. We still
        // emit a system notice for non-TUI channels (Feishu / Slack)
        // that don't have a context-compressed callback.
        this.options.onContextCompressed?.({
          keptMessages: event.keptMessages,
          summarizedTurns: event.summarizedTurns,
        });
        const msg = `(context compressed: ${event.summarizedTurns} earlier turn(s) summarized, ${event.keptMessages} message(s) kept)`;
        this.options.onSystemNotice?.(msg);
        break;
      }
      case "token_usage": {
        this.options.onTokens?.({
          input: event.input,
          output: event.output,
          total: event.total,
          ...(event.cacheRead !== undefined ? { cacheRead: event.cacheRead } : {}),
          ...(event.cacheCreation !== undefined
            ? { cacheCreation: event.cacheCreation }
            : {}),
          ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
          cumulative: event.cumulative,
        });
        break;
      }
      default:
        break;
    }
  }

  async flushFinal(): Promise<string> {
    await this.flushDeltas();
    if (this.buffer) {
      await this.flush();
    }
    return this.buffer;
  }

  private dispatcherDelta(delta: string): void {
    this.deltaBuffer += delta;
    if (this.onAssistantDelta) this.onAssistantDelta(delta);
    if (this.deltaTimer) return;
    this.deltaTimer = setTimeout(() => {
      this.deltaTimer = null;
      void this.flushDeltas();
    }, 50);
  }

  private async flushDeltas(): Promise<void> {
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }
    // The actual text has already been accumulated in `this.buffer` via
    // the handleEvent path; the deltaBuffer is just the per-batch hint
    // for listeners. Clear it unconditionally.
    this.deltaBuffer = "";
  }

  private async flush(): Promise<void> {
    const text = this.buffer.trim();
    this.buffer = "";
    if (!text) return;
    const chunkSize = this.options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    if (text.length <= chunkSize) {
      await this.dispatcher.deliver({ text });
      return;
    }
    for (let i = 0; i < text.length; i += chunkSize) {
      await this.dispatcher.deliver({ text: text.slice(i, i + chunkSize) });
    }
  }
}

export function collectAssistantText(events: AgentStreamEvent[]): string {
  let text = "";
  for (const evt of events) {
    if (evt.type === "assistant_message") text = evt.text;
    else if (evt.type === "result") text = evt.text;
  }
  return text;
}
