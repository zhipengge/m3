import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

export type RecentTool = {
  /** Tool name (Bash, Read, Edit, …). */
  name: string;
  /** Short, human-readable description of what the tool is doing — already
   *  computed by the harness's describeToolCall (e.g. "Bash: pnpm test"). */
  detail: string;
  /** Whether the call is still in flight. */
  running: boolean;
  /** Whether the call completed with an error. */
  isError?: boolean;
  /** Wall-clock ms spent in the call. */
  durationMs?: number;
};

type Props = {
  /** Currently running tool — surfaced prominently at the top. */
  current?: RecentTool;
  /** Last N completed tools (newest first). */
  recent: RecentTool[];
  /** Session turn count. */
  turns?: number;
};

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ActivityFooterImpl(props: Props) {
  const { current, recent, turns } = props;
  // Nothing to show — return null so the parent layout collapses cleanly.
  if (!current && recent.length === 0) return null;
  return (
    <Box flexDirection="column" marginY={0}>
      {current ? (
        <Box gap={1} paddingLeft={0}>
          <Text color={theme.accent} bold>
            ▸
          </Text>
          <Text color={theme.accent}>{current.name}</Text>
          <Text color={theme.muted}>·</Text>
          <Text wrap="truncate-end">{current.detail}</Text>
          {current.durationMs !== undefined ? (
            <Text color={theme.muted}> · {fmtMs(current.durationMs)}</Text>
          ) : null}
        </Box>
      ) : null}
      {recent.length > 0 ? (
        <Box gap={1} paddingLeft={2}>
          <Text color={theme.muted}>Recent:</Text>
          {recent.slice(0, 5).map((tool, i) => (
            <Box key={`${tool.name}-${i}`} gap={0}>
              <Text color={tool.isError ? theme.err : theme.muted}>{tool.name}</Text>
              {tool.durationMs !== undefined ? (
                <Text color={theme.muted}> {fmtMs(tool.durationMs)}</Text>
              ) : null}
              {i < Math.min(recent.length, 5) - 1 ? <Text color={theme.muted}> · </Text> : null}
            </Box>
          ))}
          {turns !== undefined ? (
            <Text color={theme.muted}> · turn {turns}</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

export const ActivityFooter = memo(ActivityFooterImpl);
