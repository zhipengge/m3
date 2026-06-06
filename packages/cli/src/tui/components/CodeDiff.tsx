import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import { lineDiff, tokenize, type DiffLine } from "../code-highlight.js";

export type CodeDiffProps = {
  /** Path to the file being edited, shown in the diff header. */
  filePath?: string;
  /** The "before" content (empty for Write/Add). */
  oldString?: string;
  /** The "after" content. */
  newString: string;
  /** Max lines to render (default 40). */
  maxLines?: number;
};

/**
 * Tiny code-diff view. Designed to fit in 1-3 terminal rows so the
 * TUI can stack a "▸ Edit src/foo.ts" line, this 5-line diff, and
 * the spinner without flooding the screen.
 *
 *   ┌─ Edit src/foo.ts ──────────────────────────┐
 *   │  - const x = 1;                            │
 *   │  + const x = 42;                           │
 *   │    const y = x;                            │
 *   └────────────────────────────────────────────┘
 *
 * Lines are tokenized and the keyword / string / number segments get
 * accent colors so the user can scan the change at a glance without
 * the diff melting into a wall of monochrome.
 */
function CodeDiffImpl(props: CodeDiffProps) {
  const { filePath, oldString = "", newString, maxLines = 40 } = props;
  const lines = lineDiff(oldString, newString, maxLines);
  if (lines.length === 0) return null;
  return (
    <Box
      borderStyle="round"
      borderColor={theme.muted}
      flexDirection="column"
      paddingX={1}
      marginY={0}
    >
      {filePath ? (
        <Box gap={1}>
          <Text color={theme.accent} bold>
            Edit
          </Text>
          <Text wrap="truncate-end">{filePath}</Text>
        </Box>
      ) : null}
      {lines.map((line, i) => (
        <DiffRow key={i} line={line} />
      ))}
      {lines.length === maxLines ? (
        <Text color={theme.muted}>… (truncated, see transcript for full diff)</Text>
      ) : null}
    </Box>
  );
}

function DiffRow(props: { line: DiffLine }) {
  const { op, line, oldNo, newNo } = props.line;
  // Pick a color per operation: red for -, green for +, muted for ctx.
  const opColor = op === "-" ? theme.err : op === "+" ? theme.user : theme.muted;
  const noColor = theme.muted;
  // Build the "op + linenums + content" row. We don't try to align
  // the line numbers — that needs monospace math which Ink doesn't
  // promise. A simple "  12 │ - foo" still scans well at any width.
  const leftNo = oldNo !== undefined ? String(oldNo) : "";
  const rightNo = newNo !== undefined ? String(newNo) : "";
  return (
    <Box gap={0}>
      <Text color={noColor}>{`  ${leftNo.padStart(4)} │ `}</Text>
      <Text color={opColor} bold>
        {op}{" "}
      </Text>
      <TokenizedLine line={line} opColor={opColor} />
      {rightNo ? <Text color={noColor}>{`  ${rightNo}`}</Text> : null}
    </Box>
  );
}

function TokenizedLine(props: { line: string; opColor: string }) {
  const tokens = tokenize(props.line);
  return (
    <Text>
      {tokens.map((t, i) => {
        let color: string;
        let bold = false;
        switch (t.kind) {
          case "kw":
            // Keywords stand out with a saturated color + bold.
            // theme.brand (warm orange) reads strongly against both
            // the red/green op colors of removed/added lines.
            color = theme.brand;
            bold = true;
            break;
          case "str":
            color = theme.warn;
            break;
          case "num":
            color = theme.accent;
            break;
          case "cmt":
            color = theme.muted;
            break;
          default:
            color = props.opColor;
            break;
        }
        return (
          <Text key={i} color={color} bold={bold}>
            {t.text}
          </Text>
        );
      })}
    </Text>
  );
}

export const CodeDiff = memo(CodeDiffImpl);
