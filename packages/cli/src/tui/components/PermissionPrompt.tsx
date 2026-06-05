import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { ReplPermissionRequest } from "../repl-bridge.js";

/**
 * Inline permission prompt — shown directly under the live thinking /
 * assistant text so the user reads it as a continuation of the model's
 * turn, not a floating modal in the middle of the screen.
 *
 *   ┌ Allow tool? ─────────────────────────────┐
 *   │  Bash  pnpm test                          │
 *   │  [Y] allow  ·  [N] deny                   │
 *   └──────────────────────────────────────────┘
 *
 * - Tool name in accent color, the actual command/path in muted color
 *   (the description coming from the harness is the full
 *   "Bash: pnpm test" or "Write: src/foo.ts" string, so we split on
 *   the first ": " and color them independently).
 * - One blank line gap above so it reads as a separate beat; the
 *   breathing spinner and input are pushed below.
 * - The thinking block above stays visible (with a small "paused"
 *   hint) so the user remembers there is an unfinished turn — that
 *   context is what made the old "modal in the middle of the screen"
 *   feel disorienting.
 */
export const PermissionPrompt = memo(function PermissionPrompt(props: {
  request: ReplPermissionRequest;
}) {
  const { toolName, description } = props.request;
  const sep = description.indexOf(": ");
  const headerTool = sep > 0 ? description.slice(0, sep) : toolName;
  const body = sep > 0 ? description.slice(sep + 2) : description;
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
      <Box paddingLeft={2}>
        <Text dimColor>[Y] allow · [N] deny</Text>
      </Box>
    </Box>
  );
});
