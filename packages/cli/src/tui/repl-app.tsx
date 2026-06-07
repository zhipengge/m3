import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import { listCommands } from "@m3/commands";
import { saveChannelMedia } from "@m3/channel-extensions";
import type { InboundMessage } from "@m3/channels";
import { describeToolCall } from "@m3/agent";
import { ActivityFooter, type RecentTool } from "./components/ActivityFooter.js";
import { BreathingSpinner } from "./components/BreathingSpinner.js";
import { CodeDiff } from "./components/CodeDiff.js";
import type { ChatLine } from "./components/message-types.js";
import { MessageRow } from "./components/MessageRow.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
import { StatusBar } from "./components/StatusBar.js";
import { ReplInput } from "./repl-input.js";
import { isSlashPaletteActive } from "./repl-palette.js";
import { createHistoryStore, type HistoryStore } from "./repl-history.js";
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
import { SplitView, filePathForTool } from "./components/SplitView.js";

type ReplMedia = NonNullable<InboundMessage["media"]>;

export type ReplAppProps = {
  modelLabel: string;
  workspace?: string;
  dashboardUrl?: string;
  initialThinkingExpanded?: boolean;
  /**
   * The permission mode used for channel-originated (Feishu/Slack/
   * WebChat) inbound messages. When set to "bypassPermissions", the
   * banner surfaces a one-line warning so a user who's never thought
   * about it gets a chance to reconsider before an IM-triggered Bash
   * runs unapproved.
   */
  channelPermissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  /**
   * Per-session USD cost cap. When set, the REPL surfaces a warning
   * at 90% and pauses the session at 100%, asking the user to
   * type /cost continue to resume. `0` / undefined = no cap.
   */
  costCapUsd?: number;
  onSubmit: (line: string, media?: ReplMedia) => void | Promise<void>;
};

const MAX_COMPLETED = 80;
const BANNER_ID = "__m3_banner__";
/** How many recent completed tools to show in the footer timeline. */
const RECENT_TOOLS_MAX = 5;

let msgCounter = 0;
function nextId(): string {
  msgCounter += 1;
  return `m-${msgCounter}`;
}

/**
 * Find the most recent history line whose lowercase form contains
 * `query` (case-insensitive substring). Returns null when nothing
 * matches. Used by the reverse-i-search overlay (Ctrl+R) — successive
 * presses cycle to older matches because the *first* match is the
 * most recent, and Ctrl+R walks the array backward each time.
 */
export function findReverseISearchMatch(history: string[], query: string): string | null {
  if (!query) return null;
  const q = query.toLowerCase();
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.toLowerCase().includes(q)) return history[i]!;
  }
  return null;
}

export function ReplApp(props: ReplAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  const [completed, setCompleted] = useState<ChatLine[]>(() => [
    {
      id: BANNER_ID,
      role: "system",
      text: buildBannerText(props.workspace, props.channelPermissionMode),
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
  const [permissionChoice, setPermissionChoice] = useState<
    "allow" | "deny" | "allow_session" | "deny_with_reason"
  >("allow");
  /**
   * Tools the user has chosen to "allow for this session" via the
   * [A] key — same-name calls in the same session will be approved
   * silently. Persists in-memory only; cleared on /clear or restart.
   */
  const sessionAllowedToolsRef = useRef<Set<string>>(new Set());
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [tokens, setTokens] = useState<{
    input: number;
    output: number;
    total: number;
    costUsd?: number;
    cacheRead?: number;
    cacheCreation?: number;
  } | null>(null);
  /**
   * Set when cumulative session cost crosses the configured
   * `agent.costCapUsd`. While true, new turns are refused — the
   * user has to /cost continue to resume. Cleared by that command.
   */
  const [costCapReached, setCostCapReached] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ReplMedia>([]);
  const [thinkingExpanded, setThinkingExpandedState] = useState(
    () => props.initialThinkingExpanded ?? false,
  );
  /**
   * Live tool activity. `current` is the tool call currently in flight
   * (rendered as the "▸ Read foo.ts" line above the spinner). `recent`
   * is a bounded ring of the last few completed calls shown in the
   * footer timeline ("Recent: Read · Bash · Edit"). Together they
   * give the user a clear "what is the agent doing right now" view
   * during long multi-tool turns.
   */
  const [currentTool, setCurrentTool] = useState<RecentTool | undefined>(undefined);
  /**
   * File currently shown in the left pane of SplitView. Updated
   * whenever the agent calls Read / Edit / Write — the user
   * sees the file content immediately after the tool runs.
   */
  const [viewedFile, setViewedFile] = useState<string | null>(null);
  /**
   * When true, the live region renders a split view with a file
   * viewer on the left and the chat on the right. Toggled with
   * Ctrl+T. Defaults to single-pane chat (matches Claude Code).
   */
  const [splitView, setSplitView] = useState(false);
  const [recentTools, setRecentTools] = useState<RecentTool[]>([]);
  /**
   * Edit / Write tool calls surface a tiny inline diff above the
   * spinner. Capped to one visible diff at a time (the latest) so
   * the live region doesn't grow unbounded during long refactors.
   */
  const [pendingDiff, setPendingDiff] = useState<
    | { filePath?: string; oldString?: string; newString: string }
    | null
  >(null);
  /**
   * First-byte progress message. Set on submit, cleared on the
   * first assistant/reasoning delta (i.e. the model started
   * responding). Lives as a separate state so it doesn't fight
   * with the liveThinking/liveAssistant streaming region.
   */
  const [pendingProgress, setPendingProgress] = useState<string | null>(null);
  /**
   * Interactive /permissions picker. `null` = closed. While open,
   * the input is hidden and ←/→ cycle through the three modes
   * (default / acceptEdits / plan), Enter commits, Esc cancels.
   * B9 — the picker is REPL-only; channels get the text reply.
   */
  const [permissionPicker, setPermissionPicker] = useState<
    "default" | "acceptEdits" | "plan" | null
  >(null);
  const [turnCount, setTurnCount] = useState(0);
  /** Per-call startedAt timestamp, captured when tool_use fires so we
   *  can compute durationMs in tool_result. */
  const toolStartRef = useRef<Map<string, number>>(new Map());
  /** Set when the user submits a prompt; used by onDeliver to compute
   *  the "done in 3.4s" suffix. Reset on next submit. */
  const pendingTurnStartedAtRef = useRef<number | undefined>(undefined);
  /** Session start wall-clock — drives the "0s / 5m / 1.2h" gauge in
   *  the status bar. */
  const sessionStartRef = useRef<number>(Date.now());
  /** Total tool invocations this session (visible in the status bar). */
  const toolCountRef = useRef<number>(0);
  /** Persistent command history (saved to ~/.m3/repl_history). */
  const historyRef = useRef<HistoryStore | null>(null);
  if (historyRef.current === null) historyRef.current = createHistoryStore();
  /** When the user starts arrow-recalling, the live input is saved
   *  here and restored when they leave history mode. */
  const draftRef = useRef<string>("");
  /** Current position in the history; -1 means "not in history". */
  const historyIdxRef = useRef<number>(-1);
  /**
   * Reverse-i-search state (Ctrl+R). `null` means the search
   * overlay is closed. While non-null, the input field is hidden
   * and the user types a substring; we find the most recent
   * matching history entry and show it. Enter commits; Esc
   * restores the original input and closes.
   */
  const [reverseSearch, setReverseSearch] = useState<{
    query: string;
    match: string | null;
  } | null>(null);
  const [, forceTick] = useState(0);
  // Refresh the duration gauge every 30 seconds. Cheap and rare enough
  // not to interfere with the streaming/spinner cadences.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  /** Latest currentTool detail, used inside the onToolResult sink
   *  closure (which is itself memoised) so we can look up the
   *  description without re-creating the sink every render. */
  const currentToolDetailRef = useRef<string | undefined>(undefined);
  currentToolDetailRef.current = currentTool?.detail;
  const permissionResolveRef = useRef<
    ((decision: "allow" | "deny" | "allow_session") => void) | null
  >(null);
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
      // First-byte arrived — clear the progress placeholder so it
      // doesn't sit there forever if the LLM is slow.
      if (pendingProgress) setPendingProgress(null);
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
        // Surface "✓ done in 3.4s" as a brief activity line so the user
        // gets a clear completion signal — without it, the live-region
        // cursor just disappears and the next line is ambiguous about
        // whether the turn really finished.
        const finishedAt = Date.now();
        const elapsed = pendingTurnStartedAtRef.current
          ? Math.max(0, finishedAt - pendingTurnStartedAtRef.current)
          : undefined;
        pendingTurnStartedAtRef.current = undefined;
        if (elapsed !== undefined && elapsed > 500) {
          pushCompleted({
            id: nextId(),
            role: "activity",
            text: `✓ done in ${(elapsed / 1000).toFixed(1)}s`,
          });
        }
        setCurrentTool(undefined);
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
        // Heuristic: if the message looks like a failure, render as an
        // error row (red ✗ prefix) instead of a dim system bullet —
        // makes problems stand out in the scrollback.
        const looksLikeError =
          /\b(error|failed|denied|rejected|timeout|fatal)\b/i.test(text) ||
          text.startsWith("Tool denied") ||
          text.startsWith("Permission denied");
        pushCompleted({
          id: nextId(),
          role: looksLikeError ? "error" : "system",
          text,
        });
      },
      onToolUse(info: { id: string; name: string; input: unknown }) {
        const detail = describeToolCall(info.name, info.input);
        toolStartRef.current.set(info.id, Date.now());
        toolCountRef.current += 1;
        setCurrentTool({ name: info.name, detail, running: true });
        // Track the most recent file-targeted tool so the split
        // view's left pane can follow the agent's attention.
        const f = filePathForTool(info.name, info.input);
        if (f) setViewedFile(f);
        // Surface Edit/Write changes as a tiny inline diff. Capped
        // content size (we read the input from the harness directly,
        // not the file, so the cost is bounded by the model output).
        const inp = info.input as Record<string, unknown> | undefined;
        if (info.name === "Edit" && inp) {
          const oldString = typeof inp.old_string === "string" ? inp.old_string : "";
          const newString = typeof inp.new_string === "string" ? inp.new_string : "";
          const filePath = typeof inp.file_path === "string" ? inp.file_path : undefined;
          setPendingDiff({ filePath, oldString, newString });
        } else if (info.name === "Write" && inp) {
          const newString = typeof inp.content === "string" ? inp.content : "";
          const filePath = typeof inp.file_path === "string" ? inp.file_path : undefined;
          setPendingDiff({ filePath, oldString: "", newString });
        }
        forceTick((n) => n + 1); // refresh status bar so "N tools" updates
      },
      onToolResult(info: { id: string; name: string; isError?: boolean; output?: string }) {
        const startedAt = toolStartRef.current.get(info.id) ?? Date.now();
        toolStartRef.current.delete(info.id);
        const detail = currentToolDetailRef.current ?? info.name;
        const tool: RecentTool = {
          name: info.name,
          detail,
          running: false,
          isError: info.isError,
          durationMs: Date.now() - startedAt,
        };
        setRecentTools((prev) => [tool, ...prev].slice(0, RECENT_TOOLS_MAX));
        setCurrentTool(undefined);
        // Clear the diff when the tool finishes — the user has seen
        // it, and the next tool call (or a new prompt) will replace it.
        setPendingDiff(null);
        // Surface the tool output as a chat row so the user can see
        // what the tool just produced. Skip tools whose output is
        // already covered by a dedicated card (CodeDiff for Edit/Write
        // is rendered separately above; we still want to surface Bash /
        // Read / Grep / Glob output here).
        if (info.output !== undefined && info.name !== "Edit" && info.name !== "Write") {
          pushCompleted({
            id: nextId(),
            role: "tool_output",
            text: info.output,
            toolName: info.name,
            toolDetail: detail,
            toolIsError: info.isError,
          });
        }
      },
      requestPermission(req: ReplPermissionRequest) {
        streamBufferRef.current.flushNow();
        setLoading(false);
        // Short-circuit if the user previously chose "allow for this
        // session" for this tool name. Cheap O(1) lookup; the set is
        // bounded by the number of distinct tool names used in a
        // session, which is small.
        if (sessionAllowedToolsRef.current.has(req.toolName)) {
          return Promise.resolve("allow" as const);
        }
        return new Promise<"allow" | "deny" | "allow_session">((resolve) => {
          permissionResolveRef.current = (decision) => resolve(decision);
          setPendingPermission(req);
        });
      },
      onTokens(usage) {
        // Plumb cacheRead/cacheCreation through to the StatusBar so
        // the user can see prompt-cache hit rate. The harness emits
        // these per turn (HarnessEvent.token_usage carries both);
        // the REPL just wasn't surfacing them. We keep the most
        // recent turn's cacheRead — for prompt caching the latest
        // turn is the most informative signal.
        const cumulative = usage.cumulative;
        // Cost-cap enforcement: the harness doesn't know about
        // agent.costCapUsd, so the REPL is the right gate. We
        // track the cumulative cost and warn at 90% / pause at
        // 100% of the configured cap. A user who set a cap expects
        // a hard stop; surprise overages are worse UX than the
        // occasional "approve to continue" prompt.
        const cap = props.costCapUsd;
        const cost = cumulative.costUsd;
        if (cap && cap > 0 && cost !== undefined) {
          const ratio = cost / cap;
          if (ratio >= 1 && !costCapReached) {
            setCostCapReached(true);
            pushCompleted({
              id: nextId(),
              role: "activity",
              text: `🛑 Cost cap reached: $${cost.toFixed(4)} of $${cap.toFixed(2)} cap. Type /cost continue to keep going.`,
            });
          } else if (ratio >= 0.9 && ratio < 1) {
            pushCompleted({
              id: nextId(),
              role: "activity",
              text: `💰 Cost at 90% of cap ($${cost.toFixed(4)} / $${cap.toFixed(2)}). Run /compact to shrink context, or type /cost continue.`,
            });
          }
        }
        setTokens({
          input: cumulative.input,
          output: cumulative.output,
          total: cumulative.total,
          ...(cumulative.costUsd !== undefined ? { costUsd: cumulative.costUsd } : {}),
          ...(usage.cacheRead !== undefined ? { cacheRead: usage.cacheRead } : {}),
          ...(usage.cacheCreation !== undefined
            ? { cacheCreation: usage.cacheCreation }
            : {}),
        });
      },
      onContextCompressed(info: { keptMessages: number; summarizedTurns: number }) {
        // Toast the user with a one-liner so they know context just
        // shrank and roughly by how much. The StatusBar ctx% bar
        // updates implicitly via the next /status event.
        pushCompleted({
          id: nextId(),
          role: "activity",
          text: `🗜 compressed ${info.summarizedTurns} earlier turn${info.summarizedTurns === 1 ? "" : "s"} → ${info.keptMessages} message${info.keptMessages === 1 ? "" : "s"} kept`,
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
      // /cost continue: clear the cap-reached gate. Without this
      // the user is stuck — every prompt submission is refused.
      // The cost is still visible in the StatusBar, so the user
      // is reminded of the spend on every subsequent turn.
      if (/^\/cost\s+continue$/i.test(normalized) && costCapReached) {
        setCostCapReached(false);
        pushCompleted({
          id: nextId(),
          role: "activity",
          text: "Cost cap gate cleared. Subsequent turns will continue to spend; the cap will re-trigger at the next threshold.",
        });
        setInput("");
        setPaletteIdx(0);
        return;
      }
      // Cost cap reached — refuse all other input. The /cost
      // continue branch above is the only escape. This is the
      // "hard stop" half of the cost-cap UX; the "soft warning"
      // half is the 90% toast inside onTokens.
      if (costCapReached) {
        pushCompleted({
          id: nextId(),
          role: "error",
          text: `Cost cap reached ($${tokens?.costUsd?.toFixed(4) ?? "?"} of $${props.costCapUsd?.toFixed(2) ?? "?"}). Type /cost continue to resume.`,
        });
        setInput("");
        setPaletteIdx(0);
        return;
      }
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
        // Soft-delete hint (B1): the user can /clear undo to
        // recover. Surfaced as a system row so it's visible
        // without scrollback.
        pushCompleted({
          id: nextId(),
          role: "system",
          text: "Session context cleared (soft-delete). Use /clear undo to recover from ~/.m3/transcripts/_archive/.",
        });
      }
      // B9: bare /permissions opens the interactive picker.
      // /permissions <mode> still takes a direct argument; both
      // work without leaving the REPL.
      if (/^\/permissions$/i.test(normalized)) {
        setPermissionPicker("default");
        setInput("");
        setPaletteIdx(0);
        return;
      }
      // Persist the submitted line to history before any UI mutation.
      historyRef.current?.push(normalized);
      historyIdxRef.current = -1;
      draftRef.current = "";
      appendUserMessage(normalized);
      setLoading(true);
      setLiveThinking(null);
      setLiveAssistant(null);
      streamBufferRef.current.flushNow();
      // B5: show a 3-stage progress toast so the gap between submit
      // and first byte is no longer a dead spinner. The toast lives
      // in `pendingProgress` and is replaced by the real first delta
      // via the streamBuffer callback (which now clears it).
      setPendingProgress(`▸ sending prompt (${normalized.length} chars)…`);
      // Mark the start of this turn so onDeliver can show "✓ done in 3.4s"
      pendingTurnStartedAtRef.current = Date.now();
      // Reset the tool timeline — a new turn gets a fresh "what is the
      // agent doing right now" view.
      setRecentTools([]);
      setTurnCount((n) => n + 1);
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

  const resolvePermission = useCallback((decision: "allow" | "deny" | "allow_session") => {
    permissionResolveRef.current?.(decision);
    permissionResolveRef.current = null;
    setPendingPermission(null);
    setPermissionChoice("allow"); // reset for the next prompt
    if (decision === "allow_session" && pendingPermission) {
      // Persist in-memory only; cleared on /clear or restart.
      sessionAllowedToolsRef.current.add(pendingPermission.toolName);
    }
    if (decision === "allow" || decision === "allow_session") setLoading(true);
  }, [pendingPermission]);

  // Reset the choice to "allow" whenever a new prompt arrives, so a stale
  // selection from a previous prompt doesn't carry over.
  useEffect(() => {
    if (pendingPermission) setPermissionChoice("allow");
  }, [pendingPermission]);

  useInput(
    (_char, key) => {
      // B9: interactive /permissions picker. While open, ←/→ cycle
      // through modes, Enter commits, Esc cancels. Eaten keystrokes
      // (typing) are ignored so the user doesn't accidentally set
      // a mode by typing during the picker.
      if (permissionPicker) {
        const opts = ["default", "acceptEdits", "plan"] as const;
        const idx = opts.indexOf(permissionPicker);
        if (key.leftArrow) {
          setPermissionPicker(opts[(idx - 1 + opts.length) % opts.length]!);
          return;
        }
        if (key.rightArrow) {
          setPermissionPicker(opts[(idx + 1) % opts.length]!);
          return;
        }
        if (key.return) {
          const committed = permissionPicker;
          setPermissionPicker(null);
          pushCompleted({
            id: nextId(),
            role: "system",
            text: `Permission mode set to: ${committed}\n(Note: applies to next turn; current in-flight engine still uses the loaded mode.)`,
          });
          // Note: the engine is already constructed with the
          // original permissionMode, so the change applies to the
          // NEXT turn / next session. m3.json would also need an
          // update for the change to persist across restarts; the
          // /permissions <mode> direct form does that via the
          // set_permission_mode action in the bridge.
          return;
        }
        if (key.escape) {
          setPermissionPicker(null);
          return;
        }
        return;
      }
      // Permission prompt navigation: ←/→ (and Tab/Shift+Tab) cycle
      // through the 3 options (allow / allow_session / deny), Enter
      // confirms the highlighted one, and Y/N/A / Esc still work as
      // single-key shortcuts. Lives in the parent useInput rather
      // than inside <PermissionPrompt> so the choice state is reset
      // cleanly on prompt change.
      if (pendingPermission) {
        const opts = ["allow", "allow_session", "deny", "deny_with_reason"] as const;
        const idx = opts.indexOf(permissionChoice);
        if (key.leftArrow || (key.tab && key.shift)) {
          setPermissionChoice(opts[(idx - 1 + opts.length) % opts.length]!);
          return;
        }
        if (key.rightArrow || (key.tab && !key.shift)) {
          setPermissionChoice(opts[(idx + 1) % opts.length]!);
          return;
        }
        if (key.return) {
          if (permissionChoice === "deny_with_reason") {
            // B7: don't actually deny yet — instead, pre-fill the
            // input with a "[user denied <tool> with reason: ..."
            // prefix and let the user complete the sentence.
            // The user can backspace the prefix and re-select
            // a different option if they change their mind.
            const tool = pendingPermission.toolName;
            setInput(`[user denied ${tool} with reason: `);
            setPendingPermission(null);
            setPermissionChoice("allow"); // reset for next prompt
            return;
          }
          resolvePermission(permissionChoice);
          return;
        }
        if (_char === "y" || _char === "Y") {
          resolvePermission("allow");
          return;
        }
        if (_char === "n" || _char === "N") {
          resolvePermission("deny");
          return;
        }
        if (_char === "a" || _char === "A") {
          resolvePermission("allow_session");
          return;
        }
        if (_char === "r" || _char === "R") {
          // B7: same as picking the 4th option + Enter.
          const tool = pendingPermission.toolName;
          setInput(`[user denied ${tool} with reason: `);
          setPendingPermission(null);
          setPermissionChoice("allow");
          return;
        }
        if (key.escape) {
          resolvePermission("deny");
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
      // Ctrl+L — clear screen, like in bash. ANSI escape: \x1b[2J
      // erases the visible viewport, \x1b[H moves the cursor home.
      // Ink re-renders on the next tick, so the message list re-flows
      // into the now-empty viewport. The transcript in `completed`
      // is untouched — the user can still scroll up.
      if (key.ctrl && _char === "l") {
        process.stdout.write("\x1b[2J\x1b[H");
        return;
      }
      // Ctrl+R — reverse-i-search. Saves the current input as the
      // draft, opens a search overlay. Each subsequent Ctrl+R cycles
      // to the *next* older match. Enter commits, Esc restores.
      if (key.ctrl && _char === "r") {
        if (!reverseSearch) {
          draftRef.current = input;
        }
        const store = historyRef.current!;
        const items = store.recent(1000);
        const prev = reverseSearch?.query ?? "";
        const next = findReverseISearchMatch(items, prev);
        setReverseSearch({ query: prev, match: next });
        if (next !== null) setInput(next);
        return;
      }
      // Ctrl+T toggles the split view (file viewer on the left,
      // chat on the right). Single-pane by default — opt-in, like
      // Vim splits — so a user who never asks for it isn't surprised.
      if (key.ctrl && _char === "t") {
        setSplitView((v) => !v);
        return;
      }
      // While the reverse-i-search overlay is open, the input is
      // routed there instead of the live input. Printable keys
      // extend the query, Enter commits, Esc restores the draft.
      if (reverseSearch) {
        if (key.return) {
          // Commit: keep the matched value in `input`, drop the overlay.
          setReverseSearch(null);
          return;
        }
        if (key.escape) {
          // Cancel: restore the pre-search draft.
          setInput(draftRef.current);
          setReverseSearch(null);
          return;
        }
        if (key.backspace || key.delete) {
          const q = reverseSearch.query.slice(0, -1);
          const store = historyRef.current!;
          const next = findReverseISearchMatch(store.recent(1000), q);
          setReverseSearch({ query: q, match: next });
          if (next !== null) setInput(next);
          return;
        }
        if (_char && _char.length === 1) {
          const q = reverseSearch.query + _char;
          const store = historyRef.current!;
          const next = findReverseISearchMatch(store.recent(1000), q);
          setReverseSearch({ query: q, match: next });
          if (next !== null) setInput(next);
          return;
        }
        // Eat everything else (arrows, ctrl-chords, …) so they don't
        // leak through to the ReplInput below.
        return;
      }
      // Up/Down arrow recall through the persistent history. We
      // intercept only when the palette is not active (the palette
      // uses Up/Down for its own navigation) and there's no
      // permission pending (eat-all mode).
      if (key.upArrow && !paletteActive) {
        const store = historyRef.current!;
        if (historyIdxRef.current === -1) {
          draftRef.current = input;
          historyIdxRef.current = store.recent(1000).length;
        }
        if (historyIdxRef.current > 0) {
          historyIdxRef.current -= 1;
          const items = store.recent(1000);
          const line = items[items.length - 1 - historyIdxRef.current];
          if (line !== undefined) {
            setInput(line);
            setPaletteIdx(0);
          }
        }
        return;
      }
      if (key.downArrow && !paletteActive) {
        if (historyIdxRef.current === -1) return;
        const store = historyRef.current!;
        const total = store.recent(1000).length;
        if (historyIdxRef.current < total - 1) {
          historyIdxRef.current += 1;
          const items = store.recent(1000);
          const line = items[items.length - 1 - historyIdxRef.current];
          if (line !== undefined) {
            setInput(line);
            setPaletteIdx(0);
          }
        } else {
          // Past the most recent — restore the live draft.
          historyIdxRef.current = -1;
          setInput(draftRef.current);
          setPaletteIdx(0);
        }
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

  // The chat live region is rendered identically in single-pane
  // and split-pane modes; the only difference is the outer
  // container. Build it once as a Fragment and reuse.
  const liveRegion = (
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
      {completed.length <= 1 && !liveThinking && !liveAssistant && !currentTool ? (
        <Box flexDirection="column" marginY={0}>
          <Text color={theme.muted}>Send a message or type / for commands</Text>
          {recentTools.length > 0 ? (
            <Text color={theme.muted}>
              Last: {recentTools[0]!.name}{" "}
              {recentTools[0]!.durationMs !== undefined
                ? `${(recentTools[0]!.durationMs! / 1000).toFixed(1)}s`
                : ""}
            </Text>
          ) : null}
        </Box>
      ) : null}

      {pendingPermission ? (
        <PermissionPrompt request={pendingPermission} selected={permissionChoice} />
      ) : null}

      {pendingDiff ? (
        <CodeDiff
          filePath={pendingDiff.filePath}
          oldString={pendingDiff.oldString}
          newString={pendingDiff.newString}
        />
      ) : null}

      <ActivityFooter current={currentTool} recent={recentTools} turns={turnCount} />

      {pendingProgress ? (
        <Text dimColor>{pendingProgress}</Text>
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

      {permissionPicker ? (
        <Box
          borderStyle="round"
          borderColor={theme.accent}
          paddingX={1}
          flexDirection="row"
          gap={1}
        >
          <Text color={theme.accent} bold>
            /permissions
          </Text>
          {(["default", "acceptEdits", "plan"] as const).map((mode) => {
            const active = mode === permissionPicker;
            return (
              <Text
                key={mode}
                color={active ? theme.user : theme.muted}
                bold={active}
                inverse={active}
              >
                {active ? `› ${mode} ‹` : `  ${mode}  `}
              </Text>
            );
          })}
          <Text color={theme.muted}>← → select · Enter apply · Esc cancel</Text>
        </Box>
      ) : null}

      {reverseSearch ? (
        <Box
          borderStyle="round"
          borderColor={theme.accent}
          paddingX={1}
          flexDirection="row"
          gap={1}
        >
          <Text color={theme.accent} bold>
            (reverse-i-search)
          </Text>
          <Text color={theme.muted}>{`\``}</Text>
          <Text color={theme.assistant}>{reverseSearch.query}</Text>
          <Text color={theme.muted}>{`\`:  `}</Text>
          <Text>
            {reverseSearch.match ?? <Text dimColor>(no match — Enter to keep, Esc to cancel)</Text>}
          </Text>
        </Box>
      ) : (
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
      )}
      <StatusBar
        model={props.modelLabel}
        dashboardUrl={props.dashboardUrl}
        tokens={tokens ?? undefined}
        sessionMs={Date.now() - sessionStartRef.current}
        toolCalls={toolCountRef.current}
        sessionAllowedCount={sessionAllowedToolsRef.current.size}
      />
    </Box>
  );

  return (
    <Box flexDirection="column" width="100%">
      <Static items={completed}>{renderCompleted}</Static>
      {splitView ? (
        <SplitView filePath={viewedFile} width={terminalWidth} chatHeight={0}>
          {liveRegion}
        </SplitView>
      ) : (
        liveRegion
      )}
    </Box>
  );
}

function buildBannerText(
  workspace?: string,
  channelPermissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan",
): string {
  const lines = [
"m3",
"Multi-modality · Multi-task · Multi-agent",
"Type / for commands · Ctrl+O expand thinking · Enter send · Ctrl+C exit",
  ];
  if (workspace) lines.push(`Workspace: ${workspace}`);
  // Channel-spawned runs (Feishu/Slack/WebChat) default to
  // bypassPermissions so the IM UX isn't a wall of permission
  // prompts. That's a real security trade-off: a prompt-injection
  // via a Feishu message could land a Bash call that runs without
  // approval. Surface it loudly so a user who has never opened
  // m3.json can see the deal they're getting.
  if (channelPermissionMode === "bypassPermissions") {
    lines.push(
      "⚠ Channel messages run with bypassPermissions — switch to 'default' in m3.json (run /permissions) to require approval.",
    );
  }
  return lines.join("\n");
}
