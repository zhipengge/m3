/** Batches LLM stream deltas so Ink only repaints the live region ~20fps. */

export type StreamBufferFlush = (kind: "thinking" | "assistant", delta: string) => void;

export type StreamBuffer = {
  pushThinking: (delta: string) => void;
  pushAssistant: (delta: string) => void;
  flushNow: () => void;
};

export function createStreamBuffer(
  onFlush: StreamBufferFlush,
  intervalMs = 48,
): StreamBuffer {
  let thinkingPending = "";
  let assistantPending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (thinkingPending) {
      const delta = thinkingPending;
      thinkingPending = "";
      onFlush("thinking", delta);
    }
    if (assistantPending) {
      const delta = assistantPending;
      assistantPending = "";
      onFlush("assistant", delta);
    }
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, intervalMs);
  };

  return {
    pushThinking(delta: string) {
      thinkingPending += delta;
      schedule();
    },
    pushAssistant(delta: string) {
      assistantPending += delta;
      schedule();
    },
    flushNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
  };
}
