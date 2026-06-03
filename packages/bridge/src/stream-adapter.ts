import type { AgentStreamEvent } from "@m3/agent";
import type { ReplyDispatcher } from "@m3/channels";

export type StreamAdapterOptions = {
  verboseTools?: boolean;
  chunkSize?: number;
  onAssistantDelta?: (delta: string) => void;
  onSystemNotice?: (text: string) => void;
};

export class StreamAdapter {
  private buffer = "";

  constructor(
    private readonly dispatcher: ReplyDispatcher,
    private readonly options: StreamAdapterOptions = {},
  ) {}

  async handleEvent(event: AgentStreamEvent): Promise<void> {
    switch (event.type) {
      case "assistant_delta":
        this.buffer += event.delta;
        this.options.onAssistantDelta?.(event.delta);
        break;
      case "assistant_message":
        this.buffer = event.text;
        await this.flush();
        break;
      case "tool_use":
        if (this.options.verboseTools) {
          await this.dispatcher.deliver({
            text: `(tool: ${event.name})`,
          });
        }
        await this.dispatcher.startTyping?.();
        break;
      case "tool_result":
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
        break;
      case "context_compressed": {
        const msg = `(context compressed: ${event.summarizedTurns} earlier turn(s) summarized, ${event.keptMessages} message(s) kept)`;
        this.options.onSystemNotice?.(msg);
        await this.dispatcher.deliver({ text: msg });
        break;
      }
      default:
        break;
    }
  }

  async flushFinal(): Promise<string> {
    if (this.buffer) {
      await this.flush();
    }
    return this.buffer;
  }

  private async flush(): Promise<void> {
    const text = this.buffer.trim();
    if (!text) return;
    const chunkSize = this.options.chunkSize ?? 4000;
    if (text.length <= chunkSize) {
      await this.dispatcher.deliver({ text });
    } else {
      for (let i = 0; i < text.length; i += chunkSize) {
        await this.dispatcher.deliver({ text: text.slice(i, i + chunkSize) });
      }
    }
    this.buffer = "";
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
