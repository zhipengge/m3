/**
 * Dependency-free, color-aware CLI output helpers. Used by commands that
 * print to stdout/stderr (doctor, status, install, error paths). For Ink UIs
 * see ./tui/theme.ts.
 *
 * Honors NO_COLOR (https://no-color.org) and non-TTY streams; never assumes
 * an interactive terminal.
 */

const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.M3_NO_COLOR === undefined &&
  process.stdout.isTTY === true;

function wrap(open: string, close: string): (s: string) => string {
  return useColor ? (s) => `${open}${s}${close}` : (s) => s;
}

export const c = {
  brand: wrap("\x1b[38;5;215m", "\x1b[0m"), // warm orange
  accent: wrap("\x1b[38;5;75m", "\x1b[0m"), // cool blue
  ok: wrap("\x1b[38;5;114m", "\x1b[0m"), // green
  warn: wrap("\x1b[38;5;179m", "\x1b[0m"), // amber
  err: wrap("\x1b[38;5;167m", "\x1b[0m"), // red
  muted: wrap("\x1b[2m", "\x1b[0m"),
  bold: wrap("\x1b[1m", "\x1b[0m"),
  dim: wrap("\x1b[2m", "\x1b[0m"),
};

const SYMBOLS = {
  ok: useColor ? "✓" : "[ok]",
  err: useColor ? "✗" : "[x]",
  warn: useColor ? "!" : "[!]",
  arrow: useColor ? "→" : "->",
  bullet: useColor ? "·" : "*",
};

export type StatusKind = "ok" | "warn" | "err" | "info";

const KIND_COLOR: Record<StatusKind, (s: string) => string> = {
  ok: c.ok,
  warn: c.warn,
  err: c.err,
  info: c.muted,
};
const KIND_SYMBOL: Record<StatusKind, string> = {
  ok: SYMBOLS.ok,
  warn: SYMBOLS.warn,
  err: SYMBOLS.err,
  info: SYMBOLS.arrow,
};

/** Print a single status line: `<symbol> <label>: <detail>` */
export function status(kind: StatusKind, label: string, detail?: string): void {
  const symbol = KIND_COLOR[kind](KIND_SYMBOL[kind]);
  const head = c.bold(label);
  const tail = detail ? ` ${c.muted(detail)}` : "";
  console.log(`${symbol} ${head}${tail}`);
}

export function header(title: string, subtitle?: string): void {
  const bar = c.muted("─".repeat(Math.max(0, 50 - title.length - 2)));
  console.log(`\n${c.brand(c.bold("m3"))} ${c.bold(title)} ${bar}`);
  if (subtitle) console.log(`  ${c.muted(subtitle)}`);
}

export function dim(s: string): string {
  return c.muted(s);
}

export function rule(width = 60): void {
  console.log(c.muted("─".repeat(width)));
}

export function suggest(s: string): void {
  console.log(`  ${c.accent(SYMBOLS.arrow)} ${c.muted(s)}`);
}

export const symbols = SYMBOLS;
