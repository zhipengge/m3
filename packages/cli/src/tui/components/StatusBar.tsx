import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

type Props = {
  model?: string;
  /** Context usage as a fraction (0-1). The bar caps at 100%. */
  contextPct?: number;
  goal?: string;
  dashboardUrl?: string;
  /** Cumulative session token usage. When undefined, the bar omits the
   *  token segment entirely (so a fresh session doesn't show "tok 0"). */
  tokens?: { input: number; output: number; total: number };
  /** Session wall-clock duration since startup, in ms. */
  sessionMs?: number;
  /** Total tool calls made this session. */
  toolCalls?: number;
};

/** Compact number formatter: 999 → "999", 1234 → "1.2k", 1_500_000 → "1.5M". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

const CONTEXT_BAR_WIDTH = 10;
const FILLED = "▰";
const EMPTY = "▱";

/** Build a 10-char progress bar with color hint. */
function contextBar(pct: number): { bar: string; color: string; warn: boolean } {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * CONTEXT_BAR_WIDTH);
  const bar = FILLED.repeat(filled) + EMPTY.repeat(CONTEXT_BAR_WIDTH - filled);
  const warn = clamped >= 90;
  return { bar, color: warn ? theme.warn : theme.muted, warn };
}

export function buildStatusBarText(props: Props): string {
  const parts: string[] = [];
  if (props.model) parts.push(props.model);
  if (props.tokens && (props.tokens.input || props.tokens.output)) {
    parts.push(
      `tok ${fmtTokens(props.tokens.total)} ` +
        `(↑${fmtTokens(props.tokens.input)} ↓${fmtTokens(props.tokens.output)})`,
    );
  }
  if (props.contextPct !== undefined) {
    const pct = Math.min(100, Math.round(props.contextPct * 100));
    parts.push(`ctx ${pct}%`);
  }
  if (props.sessionMs !== undefined) {
    parts.push(fmtDuration(props.sessionMs));
  }
  if (props.toolCalls !== undefined) {
    parts.push(`${props.toolCalls} tools`);
  }
  if (props.goal) parts.push("◎ goal");
  if (props.dashboardUrl) parts.push(props.dashboardUrl);
  return parts.join(" · ") || "m3";
}

function StatusBarImpl(props: Props) {
  // Each segment is wrapped with `truncate-end` so that when the
  // terminal narrows, segments shrink from the right rather than the
  // bar wrapping to a new line (which would push the rest of the
  // live region up/down on every resize — the "flicker on resize"
  // bug). The order below is also a priority: when the bar runs
  // out of room, the dashboard URL is the first to disappear,
  // then duration, then tools. Model / tokens / ctx% always
  // remain because they carry the most signal.
  const parts: React.ReactNode[] = [];
  if (props.model) {
    parts.push(
      <Text key="model" color={theme.accent} bold wrap="truncate-end">
        {props.model}
      </Text>,
    );
  }
  if (props.tokens && (props.tokens.input || props.tokens.output)) {
    parts.push(
      <Text key="tok" color={theme.muted} wrap="truncate-end">
        {`tok ${fmtTokens(props.tokens.total)} ` +
          `(↑${fmtTokens(props.tokens.input)} ↓${fmtTokens(props.tokens.output)})`}
      </Text>,
    );
  }
  if (props.contextPct !== undefined) {
    const pct = Math.min(100, Math.round(props.contextPct * 100));
    const { bar, color, warn } = contextBar(pct);
    parts.push(
      <Box key="ctx" gap={0} flexShrink={0}>
        <Text color={color}>ctx </Text>
        <Text color={color}>{bar}</Text>
        <Text color={warn ? theme.warn : theme.muted}>{` ${pct}%`}</Text>
      </Box>,
    );
  }
  if (props.sessionMs !== undefined) {
    parts.push(
      <Text key="dur" color={theme.muted} wrap="truncate-end">
        {fmtDuration(props.sessionMs)}
      </Text>,
    );
  }
  if (props.toolCalls !== undefined) {
    parts.push(
      <Text key="tools" color={theme.muted} wrap="truncate-end">
        {`${props.toolCalls} tools`}
      </Text>,
    );
  }
  if (props.goal) parts.push(<Text key="goal" color={theme.muted}>{"◎ goal"}</Text>);
  if (props.dashboardUrl) {
    parts.push(
      <Text key="dash" color={theme.muted} wrap="truncate-end">
        {props.dashboardUrl}
      </Text>,
    );
  }
  // Join with " · " dots. Each segment is wrapped in its own
  // `truncate-end` <Text> so that on terminal resize the bar stays a
  // single line — when the bar doesn't fit, secondary segments
  // (duration, tools, dashboard) truncate from the right rather
  // than the bar wrapping to 2+ lines. The wrap-to-new-line
  // behavior was the main cause of the "flicker on resize" bug:
  // the bar's height changes (1→2 lines, then 2→1) and pushes
  // the rest of the live region up/down on every resize.
  const flat: React.ReactNode[] = [];
  parts.forEach((p, i) => {
    if (i > 0) flat.push(<Text key={`sep-${i}`}>{` · `}</Text>);
    flat.push(p);
  });
  return (
    <Box
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginTop={1}
      flexDirection="row"
      flexShrink={0}
      width="100%"
      overflowX="hidden"
    >
      {flat.length > 0 ? flat : <Text dimColor>m3</Text>}
    </Box>
  );
}

export const StatusBar = memo(StatusBarImpl);
