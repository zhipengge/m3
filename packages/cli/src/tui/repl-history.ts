/**
 * Persistent command history for the REPL.
 *
 * Persists to `~/.m3/repl_history` as newline-separated lines,
 * one command per line, capped at MAX_ENTRIES (200). The store
 * is read on REPL startup and written incrementally as the
 * user submits commands.
 *
 * The file is plain UTF-8 text — easy to grep, easy to clean,
 * and human-readable for debugging. We deduplicate adjacent
 * entries on write so spamming Enter on the same command
 * doesn't bloat the file.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX_ENTRIES = 200;
const DEFAULT_PATH = "~/.m3/repl_history";

export type HistoryStore = {
  /** Append a new entry (skipped if equal to the most recent). */
  push: (line: string) => void;
  /** Read the most recent `n` entries, newest first. */
  recent: (n: number) => string[];
  /** Persist the in-memory buffer to disk (idempotent). */
  flush: () => void;
};

export function createHistoryStore(filePath: string = DEFAULT_PATH): HistoryStore {
  const resolved = filePath.startsWith("~")
    ? path.join(os.homedir(), filePath.slice(1))
    : filePath;
  const buffer: string[] = [];

  // Best-effort load. Corrupt / missing file → start empty.
  try {
    if (fs.existsSync(resolved)) {
      const text = fs.readFileSync(resolved, "utf8");
      for (const line of text.split("\n")) {
        if (line) buffer.push(line);
      }
      // Cap to last MAX_ENTRIES.
      while (buffer.length > MAX_ENTRIES) buffer.shift();
    }
  } catch {
    // ignore — start with empty history
  }

  return {
    push(line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (buffer[buffer.length - 1] === trimmed) return; // dedup adjacent
      buffer.push(trimmed);
      while (buffer.length > MAX_ENTRIES) buffer.shift();
    },
    recent(n) {
      return buffer.slice(-Math.max(0, n)).reverse();
    },
    flush() {
      try {
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, buffer.join("\n") + "\n");
      } catch {
        /* persistence is best-effort */
      }
    },
  };
}
