import { getSlashCommandSpecs } from "@m3/commands";

/** True when slash palette should capture arrows / tab (not the text field). */
export function isSlashPaletteActive(
  input: string,
  slashNames: string[],
  disabled?: boolean,
): boolean {
  if (disabled || !input.startsWith("/")) return false;
  const filter = input.slice(1).split(/\s/)[0] ?? "";
  const specs = getSlashCommandSpecs(slashNames).filter(
    (s) => !filter || s.name.toLowerCase().startsWith(filter.toLowerCase()),
  );
  return specs.length > 0;
}
