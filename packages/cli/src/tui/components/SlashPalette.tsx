import { Box, Text } from "ink";
import type { SlashCommandSpec } from "@m3/commands";
import { theme } from "../theme.js";

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

  const max = Math.min(specs.length, 10);
  const visible = specs.slice(0, max);

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
      </Text>
      <Text dimColor>↑↓ select · Enter apply · Esc close · Tab complete</Text>
      {visible.map((spec, i) => {
        const active = i === selected;
        return (
          <Box key={spec.name} gap={1}>
            <Text color={active ? theme.brand : theme.muted} bold={active}>
              {active ? "›" : " "}
            </Text>
            <Text color={active ? theme.user : theme.assistant} bold={active}>
              /{spec.name}
            </Text>
            <Text dimColor={!active}>{spec.summary}</Text>
          </Box>
        );
      })}
      {specs.length > max ? (
        <Text dimColor>… {specs.length - max} more (keep typing to filter)</Text>
      ) : null}
    </Box>
  );
}
