export type ReplPermissionRequest = {
  toolName: string;
  description: string;
};

/** Bridges gateway webchat callbacks into the Ink REPL (no global state). */
export type ReplUiSink = {
  onTyping: () => void;
  onDelta: (delta: string) => void;
  onDeliver: (text: string) => void;
  onSystem: (text: string) => void;
  /** Interactive tool approval (Ink); resolves when user presses y/n. */
  requestPermission?: (req: ReplPermissionRequest) => Promise<boolean>;
};

let activeSink: ReplUiSink | null = null;

export function setReplUiSink(sink: ReplUiSink | null): void {
  activeSink = sink;
}

export function getReplUiSink(): ReplUiSink | null {
  return activeSink;
}
