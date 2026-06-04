import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

export type ThinkingBlockProps = {
  text: string;
  streaming?: boolean;
  /** When false, only the header is shown (unless streaming — then body is always visible). */
  expanded: boolean;
};

/**
 * Cap the displayed thinking text. The full text is still kept in app state
 * (it is needed for `onDeliver` and the transcript), but re-wrapping a 50k
 * character delta stream on every spinner tick is what makes the screen
 * flicker. Truncating to the tail keeps each render O(DISPLAY_CAP) and the
 * diff small.
 */
const DISPLAY_CAP = 4000;

function buildDisplay(text: string): { display: string; hidden: number } {
  if (text.length <= DISPLAY_CAP) return { display: text, hidden: 0 };
  return { display: "…" + text.slice(-DISPLAY_CAP), hidden: text.length - DISPLAY_CAP };
}

/** Claude Code–style thinking block: ∴ Thinking + streamed reasoning body. */
export const ThinkingBlock = memo(function ThinkingBlock(props: ThinkingBlockProps) {
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

  const { display, hidden } = buildDisplay(text);

  return (
    <Box flexDirection="column" marginY={0} gap={0} width="100%">
      <Text dimColor italic>
        {label}
        {hidden > 0 ? (
          <Text dimColor> (+{hidden} chars hidden, Ctrl+O to collapse)</Text>
        ) : null}
      </Text>
      <Box paddingLeft={2}>
        <Text color={theme.thinking} dimColor wrap="truncate-end">
          {display}
          {streaming ? <Text color={theme.thinking}>▌</Text> : null}
        </Text>
      </Box>
    </Box>
  );
});
