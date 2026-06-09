import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

export type ErrorKind = "network" | "tool" | "context_overflow" | "parse" | "unknown";

const TRUNCATE = 2000;

type Props = {
  kind: ErrorKind;
  message: string;
  stack?: string;
  hint?: string;
};

/**
 * Classify a system error into one of the canonical buckets. The
 * heuristic is intentionally conservative: when in doubt, fall
 * back to "unknown" so the user still gets the red ✗ marker
 * and the hint area, just without a tailored suggestion.
 */
export function classifyError(message: string): ErrorKind {
  const lower = message.toLowerCase();
  if (
    /\b(status|statuscode|http)\s*[:=]?\s*(401|403|408|425|429|500|502|503|504)\b/i.test(
      message,
    ) ||
    /\b(unauthorized|forbidden|rate\s*limit|too\s*many\s*requests|bad\s*gateway|service\s*unavailable|timed?\s*out|timeout|ECONNRESET|ENOTFOUND)\b/i.test(
      lower,
    )
  ) {
    return "network";
  }
  if (/\b(max[_ ]?tokens|context[_ ]?length[_ ]?exceeded|too[_ ]?long)\b/i.test(message)) {
    return "context_overflow";
  }
  if (/\b(json\.parse|syntax\s*error|unexpected\s*token|parse\s*failed)\b/i.test(lower)) {
    return "parse";
  }
  return "unknown";
}

function hintFor(kind: ErrorKind): string | undefined {
  switch (kind) {
    case "network":
      return "Check your API key in `~/.m3/secrets.json` and your network connection. Try `/model` to switch provider.";
    case "tool":
      return "The tool itself failed. Inspect the output above; you may need to retry or change the input.";
    case "context_overflow":
      return "The conversation got too long. Run `/compact` to summarize and free context.";
    case "parse":
      return "The model's response couldn't be parsed. This is usually transient — try again.";
    case "unknown":
      return undefined;
  }
}

const KIND_GLYPH: Record<ErrorKind, string> = {
  network: "⚡",
  tool: "✗",
  context_overflow: "⚠",
  parse: "?",
  unknown: "✗",
};

const KIND_LABEL: Record<ErrorKind, string> = {
  network: "network",
  tool: "tool failed",
  context_overflow: "context overflow",
  parse: "parse error",
  unknown: "error",
};

function ErrorCardImpl(props: Props) {
  const { kind, message, stack, hint } = props;
  // We don't wire a useInput toggle here (Ink useInput inside
  // memoized children is fragile); the chevron + label is the
  // affordance. The card is bounded, so the stack is always
  // available at the bottom.
  const expanded = true;
  const display = message.length > TRUNCATE
    ? message.slice(0, TRUNCATE) + `… (+${message.length - TRUNCATE} chars hidden)`
    : message;
  const trimmedHint = hint ?? hintFor(kind);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.err}
      paddingX={1}
      marginY={0}
    >
      <Box gap={1}>
        <Text color={theme.err} bold>
          {KIND_GLYPH[kind]} {KIND_LABEL[kind]}
        </Text>
      </Box>
      <Box paddingLeft={2}>
        <Text wrap="wrap">{display}</Text>
      </Box>
      {stack ? (
        <Box paddingLeft={2} flexDirection="column">
          <Box gap={1}>
            <Text color={theme.muted}>{expanded ? "▾" : "▸"}</Text>
            {/* Press Enter on the row to toggle (useInput wired outside).
                Click-on-text isn't supported in Ink, so the chevron +
                label change is the affordance. */}
            <Text color={theme.muted} underline>
              {expanded ? "hide stack" : "show stack"}
            </Text>
          </Box>
          {expanded ? (
            <Text color={theme.muted} wrap="wrap">
              {stack}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {trimmedHint ? (
        <Box paddingLeft={2} marginTop={0}>
          <Text color={theme.accent} dimColor>
            ▸ {trimmedHint}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export const ErrorCard = memo(ErrorCardImpl);
