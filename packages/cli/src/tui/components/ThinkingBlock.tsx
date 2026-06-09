import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import { truncateMiddle } from "../wrap.js";

export type ThinkingBlockProps = {
  text: string;
  streaming?: boolean;
  /** When false, only the header is shown (unless streaming — then body is always visible). */
  expanded: boolean;
  /**
   * Visible column budget for the body. When omitted, Ink falls
   * back to the parent box width. The body applies a middle-truncate
   * pass so a long reasoning line can't push the rest of the row
   * off-screen on a narrow terminal.
   */
  width?: number;
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
  const { text, streaming, expanded, width } = props;
  if (!text && !streaming) return null;

  const showBody = expanded || streaming;
  const label = streaming ? "∴ Thinking…" : "∴ Thinking";

  if (!showBody) {
    const hint = text.length > 0 ? ` (${text.length} chars, Ctrl+O to expand)` : " (Ctrl+O to expand)";
    return (
      <Box flexDirection="column" marginY={0} width={width}>
        <Text dimColor italic>
          {label}
          <Text dimColor>{hint}</Text>
        </Text>
      </Box>
    );
  }

  // Empty body during streaming — just the label, no orphan cursor block.
  // Before the first delta arrives the body would be an empty wrapped line
  // with a lone "▌" — that looks broken. Wait for the first chunk before
  // drawing the body region.
  if (text.length === 0) {
    return (
      <Box flexDirection="column" marginY={0} gap={0} width={width}>
        <Text dimColor italic>{label}</Text>
      </Box>
    );
  }

  const { display, hidden } = buildDisplay(text);
  // The body has paddingLeft=2 so the visible column budget for
  // the text itself is `width - 2` when the parent passed a width.
  // Middle-truncate any single line that overflows so a runaway
  // URL or JSON blob doesn't push the whole row right.
  const bodyWidth = width !== undefined ? Math.max(20, width - 2) : undefined;
  const shaped = bodyWidth !== undefined
    ? display.split("\n").map((l) => truncateMiddle(l, bodyWidth)).join("\n")
    : display;

  return (
    <Box flexDirection="column" marginY={0} gap={0} width={width}>
      <Text dimColor italic>
        {label}
        {hidden > 0 ? (
          <Text dimColor> (+{hidden} chars hidden, Ctrl+O to collapse)</Text>
        ) : null}
      </Text>
      <Box paddingLeft={2}>
        <Text color={theme.thinking} dimColor wrap="truncate-end">
          {shaped}
          {streaming ? <Text color={theme.thinking}>▌</Text> : null}
        </Text>
      </Box>
    </Box>
  );
});
