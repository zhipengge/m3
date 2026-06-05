import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { ReplPermissionRequest } from "../repl-bridge.js";

/**
 * Inline permission prompt — shown directly under the live thinking /
 * assistant text so the user reads it as a continuation of the model's
 * turn, not a floating modal in the middle of the screen.
 *
 *   ┌ ⚠ Allow tool?  · agent paused, awaiting approval ──────────┐
 *   │   Bash  pnpm test                                           │
 *   │   ▸ [Y] allow     [N] deny                                   │
 *   └──────────────────────────────────────────────────────────────┘
 *   ← →  switch · Enter confirm · Y/N shortcut · Esc deny
 *
 * - Tool name in accent color, the actual command/path in default
 *   color, split on the first ": " from the harness description.
 * - The active option is bracketed with ▸ and rendered bold + accent
 *   color; the inactive option is dim.
 * - Keyboard navigation lives in the parent's useInput handler (so the
 *   choice resets cleanly on prompt change); this component is a
 *   pure renderer.
 */
export type PermissionChoice = "allow" | "deny";

export const PermissionPrompt = memo(function PermissionPrompt(props: {
  request: ReplPermissionRequest;
  selected: PermissionChoice;
}) {
  const { toolName, description } = props.request;
  const sep = description.indexOf(": ");
  const headerTool = sep > 0 ? description.slice(0, sep) : toolName;
  const body = sep > 0 ? description.slice(sep + 2) : description;
  const allowActive = props.selected === "allow";
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.warn}
      paddingX={1}
      marginY={0}
    >
      <Box gap={1}>
        <Text bold color={theme.warn}>
          ⚠ Allow tool?
        </Text>
        <Text dimColor>· agent paused, awaiting approval</Text>
      </Box>
      <Box gap={1} paddingLeft={2}>
        <Text bold color={theme.accent}>
          {headerTool}
        </Text>
        <Text wrap="truncate-end">{body}</Text>
      </Box>
      <Box gap={1} paddingLeft={2} paddingTop={0}>
        <Text color={allowActive ? theme.accent : theme.muted} bold={allowActive}>
          {allowActive ? "▸" : " "} [Y] allow
        </Text>
        <Text color={!allowActive ? theme.accent : theme.muted} bold={!allowActive}>
          {!allowActive ? "▸" : " "} [N] deny
        </Text>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>← → switch · Enter confirm · Y/N shortcut · Esc deny</Text>
      </Box>
    </Box>
  );
});
