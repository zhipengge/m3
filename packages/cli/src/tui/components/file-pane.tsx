import { memo, useEffect, useState } from "react";
import fs from "node:fs/promises";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

/**
 * Read a file's current content (capped). Plain text; we don't try to
 * syntax-highlight here (the chat pane already shows the diff when the
 * agent is editing) — the file pane is a passive view.
 */
async function readFileSafe(path: string, maxBytes: number): Promise<string | null> {
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile()) return null;
    if (stat.size > maxBytes) return null;
    return await fs.readFile(path, "utf8");
  } catch {
    return null;
  }
}

type Props = {
  /** Absolute path of the file to display. When null, the pane is empty. */
  filePath: string | null;
  /** Available height in lines (0 = don't clip). */
  height: number;
};

/**
 * A single-pane file viewer — the left half of SplitView. Re-fetches
 * the file on every render that has a new path. A 32KB cap protects
 * the TUI from accidentally loading a 500MB log file; the user can
 * always open it in a real editor. Width is inherited from the
 * surrounding Box (`width="100%"`), so the prop is intentionally
 * not exposed here — long lines truncate-end to fit the column.
 */
function FilePaneImpl(props: Props) {
  const { filePath, height } = props;
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!filePath) {
      setContent(null);
      setTruncated(false);
      return;
    }
    let cancelled = false;
    readFileSafe(filePath, 32_000).then((c) => {
      if (cancelled) return;
      if (c === null) {
        setContent(null);
        setTruncated(false);
        return;
      }
      setContent(c);
      setTruncated(c.length >= 32_000);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (!filePath) {
    return (
      <Box flexDirection="column" paddingX={1} width="100%">
        <Text dimColor>file pane: no file selected</Text>
      </Box>
    );
  }
  if (content === null) {
    return (
      <Box flexDirection="column" paddingX={1} width="100%">
        <Text color={theme.muted}>▾ {filePath}</Text>
        <Text dimColor>(empty or unreadable)</Text>
      </Box>
    );
  }
  const lines = content.split("\n");
  const visible = height > 0 ? lines.slice(0, height) : lines;
  return (
    <Box flexDirection="column" paddingX={1} width="100%">
      <Text color={theme.muted}>▾ {filePath}</Text>
      {visible.map((line, i) => (
        <Box key={i} gap={1}>
          <Text color={theme.muted}>{String(i + 1).padStart(4)}</Text>
          <Text wrap="truncate-end">{line}</Text>
        </Box>
      ))}
      {lines.length > visible.length ? (
        <Text color={theme.muted}>… (showing first {visible.length} of {lines.length} lines)</Text>
      ) : null}
      {truncated ? <Text color={theme.warn}>… (file truncated to 32KB)</Text> : null}
    </Box>
  );
}

export const FilePane = memo(FilePaneImpl);

/**
 * Cheap wrapper that turns a tool call into a file path candidate.
 * The split view's left pane follows the most recent Read/Edit/Write
 * call's target file. Returns null if the tool isn't file-related.
 */
export function filePathForTool(toolName: string, input: unknown): string | null {
  if (toolName !== "Read" && toolName !== "Edit" && toolName !== "Write") return null;
  if (typeof input !== "object" || input === null) return null;
  const i = input as Record<string, unknown>;
  const p = i.file_path ?? i.path;
  return typeof p === "string" && p ? p : null;
}
