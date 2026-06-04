import { Box, Text } from "ink";
import type { SlashCommandSpec } from "@m3/commands";
import { paletteViewport } from "../palette-viewport.js";
import { theme } from "../theme.js";

/**
 * How many command rows to show at once. The window scrolls vertically so the
 * selected row is always visible — users can ↓/↑ past the first page without
 * losing access to commands further down the list.
 */
const PALETTE_MAX_VISIBLE = 8;

export function SlashPalette(props: {
  specs: SlashCommandSpec[];
  selected: number;
  filter: string;
}) {
  const { specs, selected, filter } = props;
  if (specs.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.border}
        flexDirection="column"
        paddingX={1}
        marginBottom={1}
      >
        <Text dimColor>No commands match “{filter}”</Text>
      </Box>
    );
  }

  // Clamp the incoming selection so a stale index (e.g. filter just shrank
  // the list) doesn't drag the viewport off the end.
  const safeSelected = Math.max(0, Math.min(selected, specs.length - 1));
  const { start, end, above, below } = paletteViewport(specs.length, safeSelected, PALETTE_MAX_VISIBLE);
  const visible = specs.slice(start, end);

  return (
    <Box
      borderStyle="round"
      borderColor={theme.accent}
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color={theme.accent}>
        Commands {filter ? `(/${filter})` : ""}
        {specs.length > PALETTE_MAX_VISIBLE ? (
          <Text dimColor>
            {" "}· {specs.length} match{specs.length === 1 ? "" : "es"} · {safeSelected + 1}/{specs.length}
          </Text>
        ) : null}
      </Text>
      <Text dimColor>↑↓ select · Enter apply · Esc close · Tab complete</Text>
      {above > 0 ? <Text dimColor>  ↑ {above} more</Text> : null}
      {visible.map((spec, i) => {
        const realIndex = start + i;
        const active = realIndex === safeSelected;
        return (
          <Box key={spec.name} gap={1}>
            <Text color={active ? theme.brand : theme.muted} bold={active}>
              {active ? "›" : " "}
            </Text>
            <Text color={active ? theme.user : theme.assistant} bold={active}>
              /{spec.name}
            </Text>
            <Text dimColor={!active} wrap="truncate-end">
              {spec.summary}
            </Text>
          </Box>
        );
      })}
      {below > 0 ? <Text dimColor>  ↓ {below} more</Text> : null}
    </Box>
  );
}
