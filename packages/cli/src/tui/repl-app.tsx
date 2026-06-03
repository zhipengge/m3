import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import { listCommands } from "@m3/commands";
import { BreathingSpinner } from "./components/BreathingSpinner.js";
import { MessageList, type ChatLine } from "./components/MessageList.js";
import { StatusBar } from "./components/StatusBar.js";
import { ReplInput } from "./repl-input.js";
import { setReplUiSink, type ReplPermissionRequest, type ReplUiSink } from "./repl-bridge.js";
import { theme } from "./theme.js";

export type ReplAppProps = {
  modelLabel: string;
  workspace?: string;
  dashboardUrl?: string;
  onSubmit: (line: string) => void | Promise<void>;
};

let msgCounter = 0;
function nextId(): string {
  msgCounter += 1;
  return `m-${msgCounter}`;
}

export function ReplApp(props: ReplAppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<ReplPermissionRequest | null>(
    null,
  );
  const [paletteIdx, setPaletteIdx] = useState(0);
  const streamIdRef = useRef<string | null>(null);
  const permissionResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const onSubmitRef = useRef(props.onSubmit);
  onSubmitRef.current = props.onSubmit;

  const slashNames = useMemo(() => listCommands(), []);

  const appendMessage = useCallback((line: ChatLine) => {
    setMessages((prev) => [...prev, line]);
  }, []);

  const sink: ReplUiSink = useMemo(
    () => ({
      onTyping() {
        setLoading(true);
      },
      onDelta(delta: string) {
        setLoading(true);
        setMessages((prev) => {
          const sid = streamIdRef.current;
          if (sid) {
            return prev.map((m) =>
              m.id === sid ? { ...m, text: m.text + delta, streaming: true } : m,
            );
          }
          const id = nextId();
          streamIdRef.current = id;
          return [...prev, { id, role: "assistant", text: delta, streaming: true }];
        });
      },
      onDeliver(text: string) {
        setLoading(false);
        const sid = streamIdRef.current;
        streamIdRef.current = null;
        if (sid) {
          setMessages((prev) =>
            prev.map((m) => (m.id === sid ? { ...m, text, streaming: false } : m)),
          );
        } else if (text.trim()) {
          appendMessage({ id: nextId(), role: "assistant", text });
        }
      },
      onSystem(text: string) {
        appendMessage({ id: nextId(), role: "system", text });
      },
      requestPermission(req: ReplPermissionRequest) {
        setLoading(false);
        return new Promise<boolean>((resolve) => {
          permissionResolveRef.current = resolve;
          setPendingPermission(req);
        });
      },
    }),
    [appendMessage],
  );

  useLayoutEffect(() => {
    setReplUiSink(sink);
    return () => setReplUiSink(null);
  }, [sink]);

  const submitLine = useCallback(
    (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const normalized = trimmed === "?" || trimmed === "？" ? "/help" : trimmed;
      appendMessage({ id: nextId(), role: "user", text: normalized });
      setLoading(true);
      streamIdRef.current = null;
      void onSubmitRef.current(normalized);
      setInput("");
      setPaletteIdx(0);
    },
    [appendMessage],
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
      if (key.ctrl && (_char === "c" || _char === "d")) {
        if (pendingPermission) {
          resolvePermission(false);
          return;
        }
        exit();
      }
    },
    { isActive: true },
  );

  const banner = (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color={theme.brand}>
        m3
      </Text>
      <Text dimColor>Multi-modality · Multi-task · Multi-agent</Text>
      <Text dimColor>Type / for commands · ←→ move cursor · Enter send · Ctrl+C exit</Text>
      {props.workspace ? (
        <Text dimColor>Workspace: {props.workspace}</Text>
      ) : null}
    </Box>
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Static items={["banner"]}>{() => banner}</Static>
      <MessageList messages={messages} />
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
      {loading && !pendingPermission ? <BreathingSpinner /> : null}
      <ReplInput
        input={input}
        onInputChange={handleInputChange}
        onSubmitLine={submitLine}
        slashNames={slashNames}
        paletteIdx={paletteIdx}
        onPaletteIdxChange={setPaletteIdx}
        pendingPermission={pendingPermission}
        onResolvePermission={resolvePermission}
        disabled={Boolean(pendingPermission)}
      />
      <StatusBar model={props.modelLabel} dashboardUrl={props.dashboardUrl} />
    </Box>
  );
}
