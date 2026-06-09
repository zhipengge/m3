import { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
import type { ReplPermissionRequest } from "../repl-bridge.js";

export type PermissionChoice = "allow" | "deny" | "allow_session" | "deny_with_reason";

/**
 * Inline permission prompt with four options. Arrow keys
 * (`←`/`→` / `Tab`/`Shift+Tab`) cycle between the options;
 * `Enter` confirms the highlighted one. Single-key shortcuts
 * (`Y` / `N` / `A` / `R`) still work for muscle memory.
 *
 *   ┌ ⚠ Allow tool?  · agent paused, awaiting approval ───┐
 *   │   Bash  pnpm test                                    │
 *   │   ▸ [Y] allow   [A] allow for session                │
 *   │     [N] deny   [R] deny with reason                  │
 *   └──────────────────────────────────────────────────────┘
 *   ← →  switch · Enter confirm · Y/N/A/R · Esc deny
 *
 * B7: the 4th option "deny with reason" pre-fills the input
 * with a `[user denied <tool> with reason: ...]` prefix so
 * the user can complete the sentence and submit. The denial
 * + reason become a normal user message — the agent sees
 * both the original request and the user's steering in the
 * next turn.
 */
export const PermissionPrompt = memo(function PermissionPrompt(props: {
  request: ReplPermissionRequest;
  selected: PermissionChoice;
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
      <Box gap={2} paddingLeft={2} paddingTop={0} flexDirection="column">
        <Box gap={2}>
          <PermissionOption active={props.selected === "allow"} label="[Y] allow" />
          <PermissionOption active={props.selected === "allow_session"} label="[A] allow for session" />
        </Box>
        <Box gap={2}>
          <PermissionOption active={props.selected === "deny"} label="[N] deny" />
          <PermissionOption
            active={props.selected === "deny_with_reason"}
            label="[R] deny with reason"
          />
        </Box>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor>← → switch · Enter confirm · Y/N/A/R · Esc deny</Text>
      </Box>
    </Box>
  );
});

function PermissionOption({ active, label }: { active: boolean; label: string }) {
  return (
    <Text color={active ? theme.accent : theme.muted} bold={active}>
      {active ? "▸ " : "  "}
      {label}
    </Text>
  );
}
