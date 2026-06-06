import { createElement } from "react";
import { render } from "ink";
import type { M3Config } from "@m3/config";
import { registerWebChatClient, type WebChatReplSink } from "@m3/channel-extensions";
import { getReplUiSink } from "./repl-bridge.js";
import { ReplApp } from "./repl-app.js";

export type InkReplOptions = {
  peerId: string;
  config: M3Config;
  workspace?: string;
  dashboardUrl?: string;
  onLine: (line: string, media?: import("../interactive-repl.js").ReplMedia) => void | Promise<void>;
};

export async function runInkRepl(options: InkReplOptions): Promise<void> {
  const modelLabel = options.config.agent.model ?? options.config.models.default ?? "m3";

  const sinkWrapper: WebChatReplSink = {
    deliver(text) {
      getReplUiSink()?.onDeliver(text);
    },
    onTyping() {
      getReplUiSink()?.onTyping();
    },
    onDelta(delta) {
      getReplUiSink()?.onDelta(delta);
    },
    onReasoningDelta(delta) {
      getReplUiSink()?.onReasoningDelta(delta);
    },
    onSystem(text) {
      getReplUiSink()?.onSystem(text);
    },
    onTokens(usage) {
      getReplUiSink()?.onTokens?.(usage);
    },
    onToolUse(info) {
      getReplUiSink()?.onToolUse?.(info);
    },
    onToolResult(info) {
      getReplUiSink()?.onToolResult?.(info);
    },
  };

  const { waitUntilExit } = render(
    createElement(ReplApp, {
      modelLabel,
      workspace: options.workspace,
      dashboardUrl: options.dashboardUrl,
      initialThinkingExpanded: options.config.agent.thinkingDisplay === "expanded",
      onSubmit: options.onLine,
    }),
    {
      stdout: process.stdout,
      stdin: process.stdin,
      patchConsole: false,
    },
  );

  const unregister = registerWebChatClient(options.peerId, sinkWrapper);

  try {
    await waitUntilExit();
  } finally {
    unregister();
  }
}
