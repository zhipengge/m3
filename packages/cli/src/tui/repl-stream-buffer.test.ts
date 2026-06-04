import { describe, expect, it, vi } from "vitest";
import { createStreamBuffer } from "./repl-stream-buffer.js";

describe("createStreamBuffer", () => {
  it("batches deltas and flushes on flushNow", () => {
    vi.useFakeTimers();
    const flushed: string[] = [];
    const buf = createStreamBuffer((kind, delta) => {
      flushed.push(`${kind}:${delta}`);
    }, 50);

    buf.pushThinking("a");
    buf.pushThinking("b");
    expect(flushed).toEqual([]);

    vi.advanceTimersByTime(50);
    expect(flushed).toEqual(["thinking:ab"]);

    buf.pushAssistant("x");
    buf.flushNow();
    expect(flushed).toEqual(["thinking:ab", "assistant:x"]);
    vi.useRealTimers();
  });
});
