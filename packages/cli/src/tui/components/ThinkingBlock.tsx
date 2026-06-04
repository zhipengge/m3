import { Box, Text } from "ink";
import { theme } from "../theme.js";

export type ThinkingBlockProps = {
  text: string;
  streaming?: boolean;
  /** When false, only the header is shown (unless streaming — then body is always visible). */
  expanded: boolean;
};

/** Claude Code–style thinking block: ∴ Thinking + streamed reasoning body. */
export function ThinkingBlock(props: ThinkingBlockProps) {
  const { text, streaming, expanded } = props;
  if (!text && !streaming) return null;

  const showBody = expanded || streaming;
  const label = streaming ? "∴ Thinking…" : "∴ Thinking";

  if (!showBody) {
    const hint = text.length > 0 ? ` (${text.length} chars, Ctrl+O to expand)` : " (Ctrl+O to expand)";
    return (
      <Box flexDirection="column" marginY={0}>
        <Text dimColor italic>
          {label}
          <Text dimColor>{hint}</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={0} gap={0} width="100%">
      <Text dimColor italic>
        {label}
      </Text>
      <Box paddingLeft={2}>
        <Text color={theme.thinking} dimColor wrap="wrap">
          {text}
          {streaming ? <Text color={theme.thinking}>▌</Text> : null}
        </Text>
      </Box>
    </Box>
  );
}
