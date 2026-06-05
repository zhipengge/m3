import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import { listCommands } from "@m3/commands";
import { saveChannelMedia } from "@m3/channel-extensions";
import type { InboundMessage } from "@m3/channels";
import { BreathingSpinner } from "./components/BreathingSpinner.js";
import type { ChatLine } from "./components/message-types.js";
import { MessageRow } from "./components/MessageRow.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
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
import { readClipboardImage } from "../clipboard-image.js";

type ReplMedia = NonNullable<InboundMessage["media"]>;

export type ReplAppProps = {
  modelLabel: string;
  workspace?: string;
  dashboardUrl?: string;
  initialThinkingExpanded?: boolean;
  onSubmit: (line: string, media?: ReplMedia) => void | Promise<void>;
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
  /** Which option in the permission prompt is currently highlighted. */
  const [permissionChoice, setPermissionChoice] = useState<"allow" | "deny">("allow");
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [tokens, setTokens] = useState<{
    input: number;
    output: number;
    total: number;
  } | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<ReplMedia>([]);
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
    setCompleted((prev) => {
      // O(1) when the buffer has room; O(1) shift + O(N) dedup check when
      // the buffer is at MAX_COMPLETED. Previous implementation did an
      // unconditional O(N) filter + O(N) slice on every push.
      let base: ChatLine[];
      if (prev.length >= MAX_COMPLETED) {
        base = prev.slice(prev.length - MAX_COMPLETED + 1);
      } else {
        base = prev;
      }
      // Defensive dedup: ids come from a monotonic counter, so this should
      // never match, but the cost is a single O(N) scan over ≤80 items.
      if (base.some((m) => m.id === line.id)) return prev;
      base = [...base, line];
      return base;
    });
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
      onTokens(usage) {
        setTokens(usage.cumulative);
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

  /** `/cost` — show cumulative token usage in a system row. */
  const handleCostSlash = useCallback(
    (): boolean => {
      if (tokens) {
        pushCompleted({
          id: nextId(),
          role: "system",
          text: `tokens · in ${tokens.input.toLocaleString()} · out ${tokens.output.toLocaleString()} · total ${tokens.total.toLocaleString()}`,
        });
      } else {
        pushCompleted({
          id: nextId(),
          role: "system",
          text: "tokens · no usage reported yet (provider may not include usage in the stream)",
        });
      }
      return true;
    },
    [pushCompleted, tokens],
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
      if (/^\/cost$/i.test(normalized)) {
        handleCostSlash();
        setInput("");
        setPaletteIdx(0);
        return;
      }
      if (/^\/(clear|reset|new)$/i.test(normalized)) {
        // Reset cumulative token usage on session reset.
        setTokens(null);
      }
      appendUserMessage(normalized);
      setLoading(true);
      setLiveThinking(null);
      setLiveAssistant(null);
      streamBufferRef.current.flushNow();
      // Snapshot the attachments so a Ctrl+V race during the await doesn't
      // mutate the array after we've already submitted it.
      const media = pendingAttachments.length > 0 ? pendingAttachments : undefined;
      void Promise.resolve(onSubmitRef.current(normalized, media)).catch(() => {});
      setInput("");
      setPaletteIdx(0);
      setPendingAttachments([]);
    },
    [appendUserMessage, handleThinkingSlash, handleCostSlash, pendingAttachments],
  );

  /**
   * Ctrl+V: read the OS clipboard image, persist to ~/.m3/media/webchat/…,
   * and queue it as a pending attachment. Surfaced as a chip above the
   * input. Empty clipboard or non-image content is a no-op (no error).
   * Currently macOS-only — the helper returns null on Linux/Windows and
   * the keypress silently does nothing.
   */
  const handlePasteImage = useCallback(async () => {
    if (pendingPermission) return;
    const img = await readClipboardImage();
    if (!img) return;
    const saved = await saveChannelMedia({
      channelId: "webchat",
      accountId: "default",
      resourceId: `clip-${Date.now()}`,
      data: img.data,
      mimeType: img.mimeType,
      kind: "image",
    });
    setPendingAttachments((prev) => [...prev, { type: "image", path: saved.path, mimeType: saved.mimeType }]);
  }, [pendingPermission]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    if (value === "/") setPaletteIdx(0);
  }, []);

  const resolvePermission = useCallback((ok: boolean) => {
    permissionResolveRef.current?.(ok);
    permissionResolveRef.current = null;
    setPendingPermission(null);
    setPermissionChoice("allow"); // reset for the next prompt
    if (ok) setLoading(true);
  }, []);

  // Reset the choice to "allow" whenever a new prompt arrives, so a stale
  // selection from a previous prompt doesn't carry over.
  useEffect(() => {
    if (pendingPermission) setPermissionChoice("allow");
  }, [pendingPermission]);

  useInput(
    (_char, key) => {
      // Permission prompt navigation: ←/→ (and Tab/Shift+Tab) cycle between
      // [Y] allow and [N] deny, Enter confirms the highlighted one, and
      // Y/N / Esc still work as single-key shortcuts. Lives in the parent
      // useInput rather than inside <PermissionPrompt> so the choice state
      // is reset cleanly on prompt change.
      if (pendingPermission) {
        if (key.leftArrow || (key.tab && key.shift)) {
          setPermissionChoice("allow");
          return;
        }
        if (key.rightArrow || (key.tab && !key.shift)) {
          setPermissionChoice("deny");
          return;
        }
        if (key.return) {
          resolvePermission(permissionChoice === "allow");
          return;
        }
        if (_char === "y" || _char === "Y") {
          resolvePermission(true);
          return;
        }
        if (_char === "n" || _char === "N") {
          resolvePermission(false);
          return;
        }
        if (key.escape) {
          resolvePermission(false);
          return;
        }
        // Eat everything else while a permission is pending so accidental
        // typing doesn't leak into the (focused but disabled) input.
        return;
      }
      if (key.ctrl && _char === "o") {
        toggleThinkingExpanded();
        return;
      }
      if (key.ctrl && (_char === "v" || _char === "V")) {
        void handlePasteImage();
        return;
      }
      if (key.ctrl && (_char === "c" || _char === "d")) {
        exit();
      }
    },
    { isActive: !paletteActive || Boolean(pendingPermission) },
  );

  const hasActiveThinking = liveThinking?.streaming ?? false;
  const showSpinner = loading && !pendingPermission && !hasActiveThinking;

  // Stable render function for <Static>. Ink caches items by their
  // (function ref, item ref, index) tuple, so giving it a fresh inline
  // arrow on every parent render would invalidate that cache and force
  // every completed message to re-mount. Lifting this to a useCallback
  // keeps the function ref stable for the lifetime of the component.
  const renderCompleted = useCallback(
    (msg: ChatLine) =>
      msg.id === BANNER_ID ? (
        <Box key={msg.id} flexDirection="column" marginBottom={1}>
          <Text bold color={theme.brand}>
            m3
          </Text>
          <Text dimColor>Multi-modality · Multi-task · Multi-agent</Text>
          <Text dimColor>
            Type / for commands · Ctrl+O expand thinking · Enter send · Ctrl+C exit
          </Text>
          {props.workspace ? <Text dimColor>Workspace: {props.workspace}</Text> : null}
        </Box>
      ) : (
        <Box key={msg.id} marginBottom={0}>
          <MessageRow
            message={msg}
            thinkingExpanded={msg.role === "thinking"}
          />
        </Box>
      ),
    [props.workspace],
  );

  return (
    <Box flexDirection="column" width="100%">
      <Static items={completed}>{renderCompleted}</Static>

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
          <PermissionPrompt request={pendingPermission} selected={permissionChoice} />
        ) : null}

        {showSpinner ? <BreathingSpinner /> : null}

        {pendingAttachments.length > 0 ? (
          <Box
            borderStyle="round"
            borderColor={theme.accent}
            paddingX={1}
            marginBottom={0}
            flexDirection="row"
            gap={1}
          >
            <Text color={theme.accent}>📎</Text>
            <Text dimColor>
              {pendingAttachments.length} image{pendingAttachments.length === 1 ? "" : "s"} attached
            </Text>
            <Text dimColor>
              ({pendingAttachments.map((a) => a.path.split("/").pop()).join(", ")})
            </Text>
          </Box>
        ) : null}

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
        <StatusBar model={props.modelLabel} dashboardUrl={props.dashboardUrl} tokens={tokens ?? undefined} />
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
