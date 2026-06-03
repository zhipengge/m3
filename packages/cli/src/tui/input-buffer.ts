/** Clamp cursor index into [0, text.length]. */
export function clampCursor(text: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, text.length));
}

export function insertChar(text: string, cursor: number, char: string): { text: string; cursor: number } {
  const pos = clampCursor(text, cursor);
  const next = text.slice(0, pos) + char + text.slice(pos);
  return { text: next, cursor: pos + char.length };
}

export function backspaceAt(text: string, cursor: number): { text: string; cursor: number } {
  const pos = clampCursor(text, cursor);
  if (pos === 0) return { text, cursor: 0 };
  return { text: text.slice(0, pos - 1) + text.slice(pos), cursor: pos - 1 };
}

export function deleteAt(text: string, cursor: number): { text: string; cursor: number } {
  const pos = clampCursor(text, cursor);
  if (pos >= text.length) return { text, cursor: pos };
  return { text: text.slice(0, pos) + text.slice(pos + 1), cursor: pos };
}

export function moveCursor(text: string, cursor: number, delta: number): number {
  return clampCursor(text, cursor + delta);
}

export function cursorHome(): number {
  return 0;
}

export function cursorEnd(text: string): number {
  return text.length;
}
