/** Ink REPL thinking display (Ctrl+O / slash), decoupled from @m3/commands. */

export type ThinkingDisplayMode = "collapsed" | "expanded";

type Listener = () => void;

let expanded = false;
const listeners = new Set<Listener>();

export function getThinkingExpanded(): boolean {
  return expanded;
}

export function setThinkingExpanded(value: boolean): void {
  if (expanded === value) return;
  expanded = value;
  for (const fn of listeners) fn();
}

export function toggleThinkingExpanded(): boolean {
  setThinkingExpanded(!expanded);
  return expanded;
}

export function subscribeThinkingExpanded(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetThinkingExpanded(initial: boolean): void {
  expanded = initial;
  for (const fn of listeners) fn();
}
