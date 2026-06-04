import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

type Props = {
  model?: string;
  contextPct?: number;
  goal?: string;
  dashboardUrl?: string;
};

function StatusBarImpl(props: Props) {
  const parts: string[] = [];
  if (props.model) parts.push(props.model);
  if (props.contextPct !== undefined) {
    const pct = Math.min(100, Math.round(props.contextPct * 100));
    parts.push(pct >= 90 ? `ctx ${pct}% · compress soon` : `ctx ${pct}%`);
  }
  if (props.goal) parts.push("◎ goal");
  if (props.dashboardUrl) parts.push(props.dashboardUrl);

  return (
    <Box borderStyle="single" borderColor={theme.border} paddingX={1} marginTop={1}>
      <Text dimColor>{parts.join(" · ") || "m3"}</Text>
    </Box>
  );
}

export const StatusBar = memo(StatusBarImpl);
