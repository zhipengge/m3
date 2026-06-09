import { memo, useMemo } from "react";
import { Box, Text } from "ink";
import {
  groupSlashCommandsByCategory,
  type SlashCommandSpec,
} from "@m3/commands";
import { paletteViewport } from "../palette-viewport.js";
import { theme } from "../theme.js";

/**
 * How many command rows to show at once. The window scrolls vertically so the
 * selected row is always visible — users can ↓/↑ past the first page without
 * losing access to commands further down the list.
 */
const PALETTE_MAX_VISIBLE = 12;

type Props = {
  specs: SlashCommandSpec[];
  selected: number;
  filter: string;
};

function SlashPaletteImpl(props: Props) {
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

  // Group by category, then flatten with category headers as separators.
  // We do this once per render via useMemo (cheap; specs is stable per palette
  // open). The viewport math still runs over the flat list so scroll
  // behaviour is unchanged.
  const groups = useMemo(() => groupSlashCommandsByCategory(specs), [specs]);
  const flat = useMemo(() => {
    const entries: Array<
      | { kind: "header"; label: string }
      | { kind: "spec"; spec: SlashCommandSpec; index: number }
    > = [];
    for (const g of groups) {
      entries.push({ kind: "header", label: g.category });
      for (const s of g.specs) {
        entries.push({ kind: "spec", spec: s, index: specs.indexOf(s) });
      }
    }
    return entries;
  }, [groups, specs]);

  const { start, end, above, below } = paletteViewport(flat.length, safeSelected, PALETTE_MAX_VISIBLE);
  const visible = flat.slice(start, end);

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
      {visible.map((entry, i) => {
        if (entry.kind === "header") {
          return (
            <Text key={`h-${i}`} bold color={theme.brand}>
              {`  ${entry.label}`}
            </Text>
          );
        }
        const realIndex = entry.index;
        const spec = entry.spec;
        const active = realIndex === safeSelected;
        return (
          <Box key={spec.name} flexDirection="column">
            <Box gap={1}>
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
            {active ? (
              <Text color={theme.muted}>{`      ${spec.usage}`}</Text>
            ) : null}
          </Box>
        );
      })}
      {below > 0 ? <Text dimColor>  ↓ {below} more</Text> : null}
    </Box>
  );
}

/**
 * Memoized so the palette doesn't re-render when the parent re-renders for
 * unrelated reasons (e.g. a streaming delta or a spinner tick). The custom
 * comparator ensures we only re-render when the visible set, the selection,
 * or the filter string actually changed.
 */
export const SlashPalette = memo(SlashPaletteImpl, (prev, next) => {
  if (prev.filter !== next.filter) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.specs === next.specs) return true;
  if (prev.specs.length !== next.specs.length) return false;
  for (let i = 0; i < prev.specs.length; i++) {
    if (prev.specs[i] !== next.specs[i]) return false;
  }
  return true;
});
