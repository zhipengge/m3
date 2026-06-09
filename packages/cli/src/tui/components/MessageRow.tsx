import { memo } from "react";
import { Box, Text } from "ink";
import { MarkdownBlock } from "../render-markdown.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolResultCard } from "./ToolResultCard.js";
import { ErrorCard, classifyError, type ErrorKind } from "./ErrorCard.js";
import { theme } from "../theme.js";
import type { ChatLine } from "./message-types.js";

/** Same cap as ThinkingBlock — the long-stream O(N²) wrap bug applies here too. */
const DISPLAY_CAP = 4000;

type Props = {
  message: ChatLine;
  thinkingExpanded?: boolean;
  /**
   * Visible column budget for the entire row. When undefined, Ink
   * falls back to the terminal width. Passing an explicit value
   * keeps wrap math bounded during streaming — a 4k char reply at
   * 80 cols is a different shape from a 4k char reply at 200 cols.
   */
  width?: number;
};

/**
 * One chat row — no box border. Borders are reserved for the truly
 * modal / interactive UI (slash palette, permission prompt, status
 * bar), so rows are visually flat and the conversation reads as
 * flowing text. Role differentiation comes from the prefix glyph
 * and the color of that glyph.
 *
 *   you  > hello
 *   m3   Hi there
 *   ∙    (tool: Bash)
 *   ∴    Thinking…
 *   ⚠    Allow tool?   (only the permission prompt gets a border)
 *
 * Assistant / system rows use the MarkdownBlock renderer so model
 * output gets **bold**, `inline code`, code-fence syntax highlight,
 * # headers, - bullets etc. The user / activity / error roles
 * stay plain because they're typically short.
 */
function MessageRowImpl(props: Props) {
  const { message, thinkingExpanded = false, width } = props;

  if (message.role === "system") {
    return (
      <Box marginY={0} width={width}>
        <Text color={theme.muted}>∙ {message.text}</Text>
      </Box>
    );
  }

  if (message.role === "error") {
    // Use the rich ErrorCard if we have classified metadata; fall
    // back to a plain red ✗ line for un-classified legacy entries.
    const kind: ErrorKind = message.errorKind ?? classifyError(message.text);
    return (
      <Box marginY={0} width={width}>
        <ErrorCard
          kind={kind}
          message={message.text}
          {...(message.errorStack ? { stack: message.errorStack } : {})}
          {...(message.errorHint ? { hint: message.errorHint } : {})}
        />
      </Box>
    );
  }

  if (message.role === "activity") {
    return (
      <Box marginY={0} width={width}>
        <Text color={theme.muted}>· {message.text}</Text>
      </Box>
    );
  }

  if (message.role === "tool_output") {
    return (
      <Box marginY={0} width={width}>
        <ToolResultCard
          toolName={message.toolName ?? "?"}
          output={message.text}
          isError={message.toolIsError}
          {...(message.toolDetail !== undefined ? { detail: message.toolDetail } : {})}
        />
      </Box>
    );
  }

  if (message.role === "thinking") {
    return (
      <Box width={width}>
        <ThinkingBlock
          text={message.text}
          streaming={message.streaming}
          expanded={thinkingExpanded}
          width={width}
        />
      </Box>
    );
  }

  if (message.role === "user") {
    return (
      <Box flexDirection="column" marginY={0} width={width}>
        <Box gap={1}>
          <Text color={theme.user} bold>
            you
          </Text>
          <Text color={theme.muted}>›</Text>
          <Text wrap="wrap">{message.text}</Text>
        </Box>
      </Box>
    );
  }

  // assistant — markdown rendering for the streamed text. The wrap
  // algorithm inside MarkdownBlock respects DISPLAY_CAP, so the cost
  // is bounded even if the full response is much longer.
  const hidden = Math.max(0, message.text.length - DISPLAY_CAP);
  const display =
    hidden > 0 ? "…" + message.text.slice(-DISPLAY_CAP) : message.text;

  return (
    <Box flexDirection="column" marginY={0} width={width}>
      <Box gap={1}>
        <Text color={theme.accent} bold>
          m3
        </Text>
        <Text color={theme.muted}>›</Text>
      </Box>
      <Box paddingLeft={3} width={width !== undefined ? width - 3 : undefined}>
        {/* Cursor is rendered *inside* MarkdownBlock's last
            paragraph as part of the text run (see the `streaming`
            prop on MarkdownBlock). Putting it here as a sibling
            would create a separate Text node whose layout Ink
            has to recompute on every delta — visible as a one-row
            jitter at the tail of the streaming reply. */}
        <MarkdownBlock
          text={display}
          width={width !== undefined ? width - 3 : undefined}
          streaming={message.streaming}
        />
      </Box>
    </Box>
  );
}

/**
 * `React.memo` with a structural equality check: only re-render when the
 * message identity, its text, or its streaming flag actually changed. This is
 * the single biggest win during streaming — the parent re-renders ~7-20
 * times per second (spinner + delta flush), and without this guard every
 * already-completed message would re-diff each time.
 */
export const MessageRow = memo(MessageRowImpl, (prev, next) => {
  const pm = prev.message;
  const nm = next.message;
  if (
    pm === nm &&
    prev.thinkingExpanded === next.thinkingExpanded &&
    prev.width === next.width
  )
    return true;
  if (pm.id !== nm.id) return false;
  if (pm.text !== nm.text) return false;
  if (pm.streaming !== nm.streaming) return false;
  if (prev.thinkingExpanded !== next.thinkingExpanded) return false;
  // Width changes (terminal resize) must trigger a re-render so
  // the markdown re-flows to the new column budget.
  if (prev.width !== next.width) return false;
  return true;
});
