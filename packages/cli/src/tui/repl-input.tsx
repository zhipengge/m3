import { memo, useCallback, useEffect, useMemo } from "react";
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
  /**
   * When true, arrow keys / Tab / Esc are routed to the slash palette instead
   * of the text input. The text input remains focused so the user can keep
   * typing to filter the list.
   */
  paletteActive?: boolean;
};

function ReplInputImpl(props: ReplInputProps) {
  const {
    input,
    onInputChange,
    onSubmitLine,
    slashNames,
    paletteIdx,
    onPaletteIdxChange,
    pendingPermission,
    disabled,
    paletteActive = false,
  } = props;

  const showPalette = input.startsWith("/");
  const filter = input.startsWith("/") ? (input.slice(1).split(/\s/)[0] ?? "") : "";
  // Memoize the spec list so a re-render of ReplApp (e.g. spinner tick) does
  // not push a brand-new array reference down to <SlashPalette>, defeating
  // its own React.memo guard.
  const paletteSpecs = useMemo(
    () =>
      getSlashCommandSpecs(slashNames).filter(
        (s) => !filter || s.name.toLowerCase().startsWith(filter.toLowerCase()),
      ),
    [slashNames, filter],
  );

  // Whenever the filter changes the number of matching commands, clamp the
  // selection so it never points past the end of the list. The SlashPalette
  // also clamps internally for visual safety, but doing it here keeps the
  // index consistent for Tab-complete and Enter-apply.
  useEffect(() => {
    if (paletteSpecs.length === 0) {
      if (paletteIdx !== 0) onPaletteIdxChange(0);
      return;
    }
    if (paletteIdx >= paletteSpecs.length) {
      onPaletteIdxChange(paletteSpecs.length - 1);
    }
  }, [paletteSpecs.length, paletteIdx, onPaletteIdxChange]);

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

  // Palette-only key handling. Only intercepts arrows / Tab / Esc; every
  // other key falls through to the TextInput so the user can keep typing
  // to filter the list. Keeping the TextInput focused (focus={true}) is
  // critical: previously we set focus={!paletteActive} which silently
  // disabled the TextInput's own useInput, dropping all character keys.
  useInput(
    (_char, key) => {
      if (paletteSpecs.length === 0) return;
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

  // (Permission-prompt key handling — y/n/arrows/Enter/Esc — lives in
  // the parent useInput in repl-app.tsx so the selected-choice state
  // and the render both update in the same React commit and the
  // choice resets cleanly when a new prompt arrives.)

  // The TextInput stays focused whenever the input is not disabled, so
  // typing always works. Arrow keys will both move the text cursor and
  // navigate the palette (we just route them in our useInput above); the
  // visual effect is harmless because the palette list is what the user
  // sees, and the input cursor is at the end of the (short) "/foo" string.
  const inputFocused = !disabled && !pendingPermission;

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

/**
 * Memoized. Re-renders only when one of its own props changes — the parent
 * (ReplApp) re-renders on every streaming delta and spinner tick, and
 * without this guard the TextInput would re-mount, the SlashPalette would
 * re-render, and `useInput` handlers would be re-registered on every tick.
 */
export const ReplInput = memo(ReplInputImpl);
