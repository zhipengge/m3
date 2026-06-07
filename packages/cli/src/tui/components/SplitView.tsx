import { memo } from "react";
import { Box } from "ink";
import { FilePane, filePathForTool } from "./file-pane.js";
import { theme } from "../theme.js";

type Props = {
  /** Path of the file to render in the left pane. */
  filePath: string | null;
  /** Right-pane content. */
  children: React.ReactNode;
  /** Total terminal width in columns. */
  width: number;
  /** Right-pane vertical space. */
  chatHeight: number;
  /** Width ratio for the file pane (0–1). Default 0.5. */
  filePaneRatio?: number;
};

/**
 * Two-pane layout: file viewer on the left, chat on the right.
 * Rendered as a horizontal Box — Ink handles the rest. Wrapped
 * in a single box with a vertical separator so resize / width
 * changes don't visually break the divider.
 *
 * No dependency on chokidar / fs.watch — the file content is
 * re-read on each `filePath` prop change (which fires from the
 * parent's tool_use sink). The ReplApp forwards the latest
 * tool's file path into this component; the rest is free.
 */
function SplitViewImpl(props: Props) {
  const { filePath, children, width, chatHeight, filePaneRatio = 0.5 } = props;
  const fileWidth = Math.max(20, Math.floor(width * filePaneRatio));
  const chatWidth = Math.max(20, width - fileWidth - 1);
  return (
    <Box flexDirection="row" width="100%">
      <Box flexDirection="column" width={fileWidth} borderStyle="single" borderColor={theme.border}>
        <FilePane filePath={filePath} height={chatHeight} />
      </Box>
      <Box flexDirection="column" width={chatWidth} flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
}

export const SplitView = memo(SplitViewImpl);
export { filePathForTool };
