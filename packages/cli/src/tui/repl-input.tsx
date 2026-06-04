import { useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { getSlashCommandSpecs } from "@m3/commands";
import { SlashPalette } from "./components/SlashPalette.js";
import type { ReplPermissionRequest } from "./repl-bridge.js";
import { theme } from "./theme.js";

export type ReplInputProps = {
  input: string;
  onInputChange: (value: string) => void;
  onSubmitLine: (line: string) => void;
  slashNames: string[];
  paletteIdx: number;
  onPaletteIdxChange: (idx: number) => void;
  pendingPermission: ReplPermissionRequest | null;
  onResolvePermission: (ok: boolean) => void;
  disabled?: boolean;
  /** When true, arrow keys select slash commands instead of moving the cursor. */
  paletteActive?: boolean;
};

export function ReplInput(props: ReplInputProps) {
  const {
    input,
    onInputChange,
    onSubmitLine,
    slashNames,
    paletteIdx,
    onPaletteIdxChange,
    pendingPermission,
    onResolvePermission,
    disabled,
    paletteActive = false,
  } = props;

  const showPalette = input.startsWith("/");
  const filter = input.startsWith("/") ? (input.slice(1).split(/\s/)[0] ?? "") : "";
  const paletteSpecs = getSlashCommandSpecs(slashNames).filter(
    (s) => !filter || s.name.toLowerCase().startsWith(filter.toLowerCase()),
  );

  const handleSubmit = useCallback(
    (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (showPalette && paletteSpecs.length > 0) {
        const exactMatch = paletteSpecs.some((s) => trimmed === `/${s.name}`);
        const hasArgs = trimmed.includes(" ");
        const incomplete =
          trimmed === "/" || (trimmed.startsWith("/") && !hasArgs && !exactMatch);

        if (incomplete) {
          const pick = paletteSpecs[paletteIdx] ?? paletteSpecs[0];
          if (pick) {
            onInputChange(`/${pick.name} `);
            return;
          }
        }
      }

      onSubmitLine(line);
    },
    [onSubmitLine, onInputChange, paletteIdx, paletteSpecs, showPalette],
  );

  useInput(
    (_char, key) => {
      if (key.upArrow) {
        onPaletteIdxChange(paletteIdx <= 0 ? paletteSpecs.length - 1 : paletteIdx - 1);
        return;
      }
      if (key.downArrow) {
        onPaletteIdxChange((paletteIdx + 1) % paletteSpecs.length);
        return;
      }
      if (key.escape) {
        onInputChange("");
        onPaletteIdxChange(0);
        return;
      }
      if (key.tab && !key.shift) {
        const pick = paletteSpecs[paletteIdx] ?? paletteSpecs[0];
        if (pick) onInputChange(`/${pick.name}`);
      }
    },
    { isActive: paletteActive },
  );

  useInput(
    (char) => {
      const c = char.toLowerCase();
      if (c === "y") onResolvePermission(true);
      else if (c === "n") onResolvePermission(false);
    },
    { isActive: Boolean(pendingPermission) },
  );

  const inputFocused = !disabled && !pendingPermission && !paletteActive;

  return (
    <Box flexDirection="column" flexShrink={0} width="100%">
      {showPalette && paletteSpecs.length > 0 ? (
        <SlashPalette specs={paletteSpecs} selected={paletteIdx} filter={filter} />
      ) : null}
      <Box flexDirection="row" width="100%" gap={1}>
        <Text color={theme.user} bold>
          ›
        </Text>
        <Box flexGrow={1}>
          <TextInput
            value={input}
            onChange={onInputChange}
            onSubmit={handleSubmit}
            focus={inputFocused}
            showCursor={inputFocused}
            placeholder={disabled ? "…" : ""}
          />
        </Box>
      </Box>
    </Box>
  );
}
