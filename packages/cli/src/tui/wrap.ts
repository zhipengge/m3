/**
 * Terminal-width-aware text shaping helpers.
 *
 * Goals (TUI is not an IDE — keep the dependency surface small):
 *   1. `truncateMiddle` — show "head…tail" for a single long token
 *      (URL, file path, diff hunk, env-var value) so the user can
 *      still see the meaningful ends instead of an unrelated suffix.
 *   2. `sliceVisible` — clamp a multi-line string to a column budget
 *      and row budget, appending a "… (N hidden)" footer when trimmed.
 *   3. `useTerminalWidth` — Ink-style hook that subscribes to the
 *      stdout `resize` event and re-renders so a window shrink/grow
 *      reflows the chat in real time.
 *
 * All three are pure / no-state; the hook is the only one that
 * reaches into Node. Keep that surface tiny so the components stay
 * easy to test.
 */

import { useEffect, useState } from "react";
import { useStdout } from "ink";

/**
 * Truncate a string in the middle so the head and tail are both
 * preserved. Returns the input unchanged when it already fits.
 *
 * Example (maxWidth=20):
 *   "/usr/local/share/very/long/path/file.ts" → "/usr/lo…/file.ts"
 *
 * The "…" takes 1 column. The algorithm is O(N) — we don't try to
 * be clever about grapheme clusters because terminal cells ≠ graphemes
 * anyway (CJK, emoji, ZWJ sequences) and the conservative cut is
 * almost always correct.
 */
export function truncateMiddle(s: string, maxWidth: number): string {
  // Display width of an arbitrary string — sum of code points is a
  // close-enough lower bound for monospace cells. We deliberately
  // don't import `string-width` to keep the bundle small; if a user
  // really cares about emoji width, this is the wrong function.
  const width = (x: string) => Array.from(x).length;
  if (width(s) <= maxWidth) return s;
  if (maxWidth <= 1) return "…";
  // Keep ~2/3 of the budget on the head (file paths usually want
  // the directory prefix) and ~1/3 on the tail (the basename /
  // query string). Floor to avoid the "…" eating a real char.
  const headBudget = Math.max(1, Math.floor((maxWidth - 1) * 0.6));
  const tailBudget = Math.max(1, maxWidth - 1 - headBudget);
  const chars = Array.from(s);
  const head = chars.slice(0, headBudget).join("");
  const tail = chars.slice(chars.length - tailBudget).join("");
  return `${head}…${tail}`;
}

/**
 * Cap a string to `maxChars`, then split on newlines and cap each
 * line to `lineWidth` columns (via `truncateMiddle`). Returns
 * `display` + `hidden` so the caller can show a "… (N hidden)"
 * footer.
 */
export function sliceVisible(
  s: string,
  opts: { maxChars?: number; maxLines?: number; lineWidth?: number } = {},
): { display: string; hiddenChars: number; hiddenLines: number } {
  const maxChars = opts.maxChars ?? 4000;
  const maxLines = opts.maxLines ?? 200;
  const lineWidth = opts.lineWidth ?? 200;
  const truncatedByChars = s.length > maxChars;
  const capped = truncatedByChars ? s.slice(0, maxChars) : s;
  const allLines = capped.split("\n");
  const totalLines = s.split("\n").length;
  const truncatedByLines = allLines.length > maxLines;
  const lines = (truncatedByLines ? allLines.slice(0, maxLines) : allLines).map((l) =>
    truncateMiddle(l, lineWidth),
  );
  return {
    display: lines.join("\n"),
    hiddenChars: truncatedByChars ? s.length - maxChars : 0,
    hiddenLines: truncatedByLines ? totalLines - maxLines : 0,
  };
}

/**
 * Live terminal width. Subscribes to stdout's `resize` event so a
 * window shrink/grow reflows the chat in real time. The default
 * is `process.stdout.columns ?? 80` when no stdout is available
 * (e.g. in tests).
 */
export function useTerminalWidth(): number {
  const { stdout } = useStdout();
  const [width, setWidth] = useState<number>(stdout?.columns ?? 80);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setWidth(stdout.columns ?? 80);
    stdout.on("resize", onResize);
    // Sync once on mount in case the parent's `width` was stale.
    setWidth(stdout.columns ?? 80);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return width;
}
