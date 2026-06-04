import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import { listCommands } from "@m3/commands";
import { BreathingSpinner } from "./components/BreathingSpinner.js";
import type { ChatLine } from "./components/message-types.js";
import { MessageRow } from "./components/MessageRow.js";
import { StatusBar } from "./components/StatusBar.js";
import { ReplInput } from "./repl-input.js";
import { isSlashPaletteActive } from "./repl-palette.js";
import { setReplUiSink, type ReplPermissionRequest, type ReplUiSink } from "./repl-bridge.js";
import {
  getThinkingExpanded,
  resetThinkingExpanded,
  setThinkingExpanded,
  subscribeThinkingExpanded,
  toggleThinkingExpanded,
} from "./repl-thinking.js";
import { createStreamBuffer } from "./repl-stream-buffer.js";
import { theme } from "./theme.js";

export type ReplAppProps = {
  modelLabel: string;
  workspace?: string;
  dashboardUrl?: string;
  initialThinkingExpanded?: boolean;
  onSubmit: (line: string) => void | Promise<void>;
};

const MAX_COMPLETED = 80;
const BANNER_ID = "__m3_banner__";

let msgCounter = 0;
function nextId(): string {
  msgCounter += 1;
  return `m-${msgCounter}`;
}

export function ReplApp(props: ReplAppProps) {
  const { exit } = useApp();
  const [completed, setCompleted] = useState<ChatLine[]>(() => [
    {
      id: BANNER_ID,
      role: "system",
      text: buildBannerText(props.workspace),
    },
  ]);
  const [liveThinking, setLiveThinking] = useState<ChatLine | null>(null);
  const [liveAssistant, setLiveAssistant] = useState<ChatLine | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<ReplPermissionRequest | null>(
    null,
  );
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [thinkingExpanded, setThinkingExpandedState] = useState(
    () => props.initialThinkingExpanded ?? false,
  );
  const permissionResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const onSubmitRef = useRef(props.onSubmit);
  onSubmitRef.current = props.onSubmit;

  const slashNames = useMemo(() => listCommands(), []);
  const inputDisabled = Boolean(pendingPermission);
  const paletteActive = isSlashPaletteActive(input, slashNames, inputDisabled);

  const pushCompleted = useCallback((line: ChatLine) => {
    setCompleted((prev) => [...prev.filter((m) => m.id !== line.id), line].slice(-MAX_COMPLETED));
  }, []);

  const finalizeLiveThinking = useCallback(() => {
    setLiveThinking((current) => {
      if (current) {
        pushCompleted({ ...current, streaming: false });
      }
      return null;
    });
  }, [pushCompleted]);

  const streamBufferRef = useRef(
    createStreamBuffer((kind, delta) => {
      if (kind === "thinking") {
        setLoading(true);
        setLiveThinking((prev) => {
          if (prev) {
            return { ...prev, text: prev.text + delta, streaming: true };
          }
          return { id: nextId(), role: "thinking", text: delta, streaming: true };
        });
        return;
      }
      setLoading(true);
      setLiveAssistant((prev) => {
        if (prev) {
          return { ...prev, text: prev.text + delta, streaming: true };
        }
        return { id: nextId(), role: "assistant", text: delta, streaming: true };
      });
    }),
  );

  useEffect(() => {
    resetThinkingExpanded(props.initialThinkingExpanded ?? false);
    setThinkingExpandedState(getThinkingExpanded());
    return subscribeThinkingExpanded(() => {
      setThinkingExpandedState(getThinkingExpanded());
    });
  }, [props.initialThinkingExpanded]);

  const sink: ReplUiSink = useMemo(
    () => ({
      onTyping() {
        setLoading(true);
      },
      onReasoningDelta(delta: string) {
        streamBufferRef.current.pushThinking(delta);
      },
      onDelta(delta: string) {
        streamBufferRef.current.flushNow();
        finalizeLiveThinking();
        streamBufferRef.current.pushAssistant(delta);
      },
      onDeliver(text: string) {
        streamBufferRef.current.flushNow();
        setLoading(false);
        finalizeLiveThinking();
        setLiveAssistant((current) => {
          if (current) {
            pushCompleted({ ...current, text, streaming: false });
            return null;
          }
          if (text.trim()) {
            pushCompleted({ id: nextId(), role: "assistant", text });
          }
          return null;
        });
      },
      onSystem(text: string) {
        streamBufferRef.current.flushNow();
        pushCompleted({ id: nextId(), role: "system", text });
      },
      requestPermission(req: ReplPermissionRequest) {
        streamBufferRef.current.flushNow();
        setLoading(false);
        return new Promise<boolean>((resolve) => {
          permissionResolveRef.current = resolve;
          setPendingPermission(req);
        });
      },
    }),
    [finalizeLiveThinking, pushCompleted],
  );

  useLayoutEffect(() => {
    setReplUiSink(sink);
    return () => setReplUiSink(null);
  }, [sink]);

  const appendUserMessage = useCallback(
    (text: string) => {
      pushCompleted({ id: nextId(), role: "user", text });
    },
    [pushCompleted],
  );

  const handleThinkingSlash = useCallback(
    (line: string): boolean => {
      const match = line.trim().match(/^\/thinking(?:\s+(\S+))?$/i);
      if (!match) return false;
      const arg = match[1]?.toLowerCase();
      if (!arg || arg === "toggle") toggleThinkingExpanded();
      else if (arg === "expand" || arg === "on" || arg === "open") setThinkingExpanded(true);
      else if (arg === "collapse" || arg === "off" || arg === "close") setThinkingExpanded(false);
      else {
        pushCompleted({
          id: nextId(),
          role: "system",
          text: "Usage: /thinking [toggle|expand|collapse]",
        });
        return true;
      }
      pushCompleted({
        id: nextId(),
        role: "system",
        text: `Thinking display: ${getThinkingExpanded() ? "expanded" : "collapsed"} (Ctrl+O)`,
      });
      return true;
    },
    [pushCompleted],
  );

  const submitLine = useCallback(
    (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const normalized = trimmed === "?" || trimmed === "？" ? "/help" : trimmed;
      if (handleThinkingSlash(normalized)) {
        setInput("");
        setPaletteIdx(0);
        return;
      }
      appendUserMessage(normalized);
      setLoading(true);
      setLiveThinking(null);
      setLiveAssistant(null);
      streamBufferRef.current.flushNow();
      void onSubmitRef.current(normalized);
      setInput("");
      setPaletteIdx(0);
    },
    [appendUserMessage, handleThinkingSlash],
  );

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    if (value === "/") setPaletteIdx(0);
  }, []);

  const resolvePermission = useCallback((ok: boolean) => {
    permissionResolveRef.current?.(ok);
    permissionResolveRef.current = null;
    setPendingPermission(null);
    if (ok) setLoading(true);
  }, []);

  useInput(
    (_char, key) => {
      if (key.ctrl && _char === "o") {
        toggleThinkingExpanded();
        return;
      }
      if (key.ctrl && (_char === "c" || _char === "d")) {
        if (pendingPermission) {
          resolvePermission(false);
          return;
        }
        exit();
      }
    },
    { isActive: !paletteActive || Boolean(pendingPermission) },
  );

  const hasActiveThinking = liveThinking?.streaming ?? false;
  const showSpinner = loading && !pendingPermission && !hasActiveThinking;

  return (
    <Box flexDirection="column" width="100%">
      <Static items={completed}>
        {(msg) =>
          msg.id === BANNER_ID ? (
            <Box key={msg.id} flexDirection="column" marginBottom={1}>
              <Text bold color={theme.brand}>
                m3
              </Text>
              <Text dimColor>Multi-modality · Multi-task · Multi-agent</Text>
              <Text dimColor>
                Type / for commands · Ctrl+O expand thinking · Enter send · Ctrl+C exit
              </Text>
              {props.workspace ? (
                <Text dimColor>Workspace: {props.workspace}</Text>
              ) : null}
            </Box>
          ) : (
            <Box key={msg.id} marginBottom={0}>
              <MessageRow
                message={msg}
                thinkingExpanded={msg.role === "thinking"}
              />
            </Box>
          )
        }
      </Static>

      <Box flexDirection="column" flexShrink={0} width="100%">
        {liveThinking ? (
          <MessageRow
            message={liveThinking}
            thinkingExpanded={thinkingExpanded || Boolean(liveThinking.streaming)}
          />
        ) : null}
        {liveAssistant ? (
          <MessageRow message={liveAssistant} thinkingExpanded={false} />
        ) : null}
        {completed.length <= 1 && !liveThinking && !liveAssistant ? (
          <Text dimColor>Send a message or type / for commands</Text>
        ) : null}

        {pendingPermission ? (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={theme.warn}
            paddingX={1}
            marginY={1}
          >
            <Text bold color={theme.warn}>
              Allow tool?
            </Text>
            <Text>
              {pendingPermission.toolName}
              {pendingPermission.description ? ` — ${pendingPermission.description}` : ""}
            </Text>
            <Text dimColor>[y] allow · [n] deny</Text>
          </Box>
        ) : null}

        {showSpinner ? <BreathingSpinner /> : null}

        <ReplInput
          input={input}
          onInputChange={handleInputChange}
          onSubmitLine={submitLine}
          slashNames={slashNames}
          paletteIdx={paletteIdx}
          onPaletteIdxChange={setPaletteIdx}
          pendingPermission={pendingPermission}
          onResolvePermission={resolvePermission}
          disabled={inputDisabled}
          paletteActive={paletteActive}
        />
        <StatusBar model={props.modelLabel} dashboardUrl={props.dashboardUrl} />
      </Box>
    </Box>
  );
}

function buildBannerText(workspace?: string): string {
  const lines = [
    "m3",
    "Multi-modality · Multi-task · Multi-agent",
    "Type / for commands · Ctrl+O expand thinking · Enter send · Ctrl+C exit",
  ];
  if (workspace) lines.push(`Workspace: ${workspace}`);
  return lines.join("\n");
}
