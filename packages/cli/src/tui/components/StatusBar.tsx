import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

type Props = {
  model?: string;
  contextPct?: number;
  goal?: string;
  dashboardUrl?: string;
  /** Cumulative session token usage. When undefined, the bar omits the
   *  token segment entirely (so a fresh session doesn't show "tok 0"). */
  tokens?: { input: number; output: number; total: number };
};

/** Compact number formatter: 999 → "999", 1234 → "1.2k", 1_500_000 → "1.5M". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
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
    parts.push(pct >= 90 ? `ctx ${pct}% · compress soon` : `ctx ${pct}%`);
  }
  if (props.goal) parts.push("◎ goal");
  if (props.dashboardUrl) parts.push(props.dashboardUrl);
  return parts.join(" · ") || "m3";
}

function StatusBarImpl(props: Props) {
  return (
    <Box borderStyle="round" borderColor={theme.border} paddingX={1} marginTop={1}>
      <Text dimColor>{buildStatusBarText(props)}</Text>
    </Box>
  );
}

export const StatusBar = memo(StatusBarImpl);
