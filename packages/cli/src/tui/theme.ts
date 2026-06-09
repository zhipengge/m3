/** Terminal palette inspired by Claude Code warm/cool accents. */
export const theme = {
  brand: "#E8956D",
  accent: "#6BB6FF",
  user: "#7EE787",
  assistant: "#E6EDF3",
  muted: "#8B949E",
  border: "#30363D",
  paletteBg: "#161B22",
  spinner: ["#6BB6FF", "#79C0FF", "#A5D6FF", "#C9E6FF", "#A5D6FF", "#79C0FF"] as const,
  system: "#D2A8FF",
  thinking: "#8B949E",
  /** Alias used by the rest of the codebase — `theme.err` is the
   *  canonical name, `theme.error` is preserved for back-compat. */
  err: "#FF7B72",
  error: "#FF7B72",
  warn: "#E3B341",
} as const;
