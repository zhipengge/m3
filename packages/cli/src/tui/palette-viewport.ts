/**
 * Viewport math for the slash-command palette. The list can be longer than
 * fits on screen; we show a fixed-size window that *follows the selected
 * row* (Claude Code style) so ↓ / ↑ can always reach every command.
 *
 * Invariants:
 *  - `start >= 0`
 *  - `end <= items.length`
 *  - `end - start <= maxVisible`
 *  - `start <= selected < end`  (the selected row is always inside the window)
 *  - If `items.length <= maxVisible`, `start === 0` and `end === items.length`
 *
 * The function is pure: caller passes the items, current selected index, and
 * the window size; we return the inclusive start / exclusive end of the
 * window. Side effects (counters) are not allowed here so it stays testable.
 */
export function paletteViewport(
  itemCount: number,
  selected: number,
  maxVisible: number,
): { start: number; end: number; above: number; below: number } {
  if (itemCount <= 0) return { start: 0, end: 0, above: 0, below: 0 };
  const visible = Math.max(1, Math.min(maxVisible, itemCount));
  // Clamp the incoming selection (caller may not have clamped yet).
  const sel = Math.max(0, Math.min(selected, itemCount - 1));

  // Default window: align selected to the bottom of the window so the user
  // gets one row of "look-ahead" while scrolling down.
  let start = Math.max(0, sel - visible + 1);
  // If the window doesn't reach the end, prefer to keep the window as full
  // as possible by extending the end (only when the list is small).
  let end = Math.min(itemCount, start + visible);
  // And then re-anchor so `selected` is inside.
  if (end - start < visible && end < itemCount) {
    start = Math.max(0, end - visible);
  }
  if (sel < start) start = sel;
  if (sel >= end) start = sel - visible + 1;

  return { start, end, above: start, below: itemCount - end };
}
