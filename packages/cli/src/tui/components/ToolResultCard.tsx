import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

/**
 * Renders a tool's stdout-style result as a card. Three specialised
 * renderers — BashOutput, ReadPreview, GrepResults — and a generic
 * PlainOutput fallback. Dispatched by `toolName`. Modeled on Claude
 * Code's tool output card.
 */

const MAX_CARD_LINES = 200;
const MAX_LINE_WIDTH = 200;
const CARD_TRUNCATION = 4000;

type Props = {
  toolName: string;
  detail?: string;
  output: string;
  isError?: boolean;
};

function truncateOutput(s: string): { display: string; truncated: number } {
  if (s.length <= CARD_TRUNCATION) return { display: s, truncated: 0 };
  return {
    display: s.slice(0, CARD_TRUNCATION),
    truncated: s.length - CARD_TRUNCATION,
  };
}

function BashOutput({ output, isError, detail }: { output: string; isError?: boolean; detail?: string }) {
  // Split stdout and stderr by the synthetic "STDERR:" sentinel the
  // bridge pipeline emits; fall back to "all stdout" if not present.
  const stderrIdx = output.indexOf("\nSTDERR:");
  const stdout = stderrIdx >= 0 ? output.slice(0, stderrIdx) : output;
  const stderr = stderrIdx >= 0 ? output.slice(stderrIdx + "\nSTDERR:".length) : "";
  const exitMatch = /\n\(exit (\d+)\)\s*$/.exec(stdout + stderr);
  const exitCode = exitMatch?.[1];

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isError ? theme.err : theme.border}
      paddingX={1}
      marginY={0}
    >
      {detail ? (
        <Box gap={1}>
          <Text color={theme.muted}>$</Text>
          <Text wrap="truncate-end">{detail}</Text>
        </Box>
      ) : null}
      {stdout.trim() ? (
        <Text wrap="truncate-end">
          {stdout
            .split("\n")
            .slice(0, MAX_CARD_LINES)
            .map((l) => l.slice(0, MAX_LINE_WIDTH))
            .join("\n")}
        </Text>
      ) : null}
      {stderr.trim() ? (
        <Text color={theme.warn} wrap="truncate-end">
          {stderr
            .split("\n")
            .slice(0, MAX_CARD_LINES)
            .map((l) => l.slice(0, MAX_LINE_WIDTH))
            .join("\n")}
        </Text>
      ) : null}
      {exitCode !== undefined ? (
        <Text color={Number(exitCode) === 0 ? theme.muted : theme.err}>
          {`(exit ${exitCode})`}
        </Text>
      ) : null}
    </Box>
  );
}

function ReadPreview({ output, detail }: { output: string; detail?: string }) {
  // Output is the file body; render with line numbers ("cat -n" style).
  const lines = output.split("\n");
  const visible = lines.slice(0, MAX_CARD_LINES);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginY={0}
    >
      {detail ? (
        <Text color={theme.muted} wrap="truncate-end">
          {detail}
        </Text>
      ) : null}
      {visible.map((line, i) => (
        <Box key={i} gap={1}>
          <Text color={theme.muted}>{String(i + 1).padStart(4)}</Text>
          <Text wrap="truncate-end">{line.slice(0, MAX_LINE_WIDTH)}</Text>
        </Box>
      ))}
      {lines.length > MAX_CARD_LINES ? (
        <Text color={theme.muted}>… (showing first {MAX_CARD_LINES} of {lines.length} lines)</Text>
      ) : null}
    </Box>
  );
}

function GrepResults({ output, detail }: { output: string; detail?: string }) {
  // Each non-empty line is a match in "path:line: content" form.
  const lines = output.split("\n").filter(Boolean);
  const visible = lines.slice(0, MAX_CARD_LINES);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginY={0}
    >
      {detail ? (
        <Text color={theme.muted} wrap="truncate-end">
          {detail}
        </Text>
      ) : null}
      {visible.length === 0 ? (
        <Text color={theme.muted}>(no matches)</Text>
      ) : (
        visible.map((line, i) => {
          const m = /^([^:]+):(\d+):(.*)$/.exec(line);
          if (m) {
            return (
              <Box key={i} gap={1} flexDirection="row">
                <Text color={theme.accent}>{m[1]}</Text>
                <Text color={theme.muted}>:</Text>
                <Text color={theme.muted}>{m[2]}</Text>
                <Text color={theme.muted}>:</Text>
                <Text wrap="truncate-end">{m[3]}</Text>
              </Box>
            );
          }
          return (
            <Text key={i} wrap="truncate-end">
              {line}
            </Text>
          );
        })
      )}
      {lines.length > MAX_CARD_LINES ? (
        <Text color={theme.muted}>… (showing first {MAX_CARD_LINES} of {lines.length} matches)</Text>
      ) : null}
    </Box>
  );
}

function GlobList({ output, detail }: { output: string; detail?: string }) {
  const paths = output.split("\n").filter(Boolean);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginY={0}
    >
      {detail ? (
        <Text color={theme.muted} wrap="truncate-end">
          {detail}
        </Text>
      ) : null}
      {paths.length === 0 ? (
        <Text color={theme.muted}>(no matches)</Text>
      ) : (
        paths.slice(0, MAX_CARD_LINES).map((p, i) => (
          <Text key={i} wrap="truncate-end" color={theme.accent}>
            {p}
          </Text>
        ))
      )}
      {paths.length > MAX_CARD_LINES ? (
        <Text color={theme.muted}>… (showing first {MAX_CARD_LINES} of {paths.length} files)</Text>
      ) : null}
    </Box>
  );
}

function PlainOutput({ output }: { output: string }) {
  const { display, truncated } = truncateOutput(output);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginY={0}
    >
      <Text wrap="truncate-end">{display}</Text>
      {truncated > 0 ? (
        <Text color={theme.muted}>(+{truncated} chars hidden)</Text>
      ) : null}
    </Box>
  );
}

function ToolResultCardImpl(props: Props) {
  const { toolName, output, isError } = props;
  switch (toolName) {
    case "Bash":
      return <BashOutput output={output} isError={isError} detail={props.detail} />;
    case "Read":
      return <ReadPreview output={output} detail={props.detail} />;
    case "Grep":
      return <GrepResults output={output} detail={props.detail} />;
    case "Glob":
      return <GlobList output={output} detail={props.detail} />;
    default:
      return <PlainOutput output={output} />;
  }
}

export const ToolResultCard = memo(ToolResultCardImpl);
export { MAX_CARD_LINES };
