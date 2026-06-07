import fs from "node:fs";
import path from "node:path";
import { expandHome } from "@m3/config";

/**
 * Project memory loader (C7).
 *
 * Reads well-known memory files on REPL startup and concatenates
 * them into a single system-prompt block. The convention follows
 * Claude Code's CLAUDE.md, with two extensions m3 has natively:
 *
 *   - User-level: ~/.m3/CLAUDE.md (always loaded when present)
 *   - Project-level (in walk order, child wins):
 *       ./CLAUDE.md
 *       ./AGENTS.md
 *       ./.claude/CLAUDE.md
 *       <each parent dir up to $HOME or git root>
 *
 * Only the first existing file at each directory level is read
 * (so a project's ./CLAUDE.md shadows a parent's, but the
 * project's other names still load if ./CLAUDE.md is absent).
 *
 * The block is capped at 16 KB so a runaway CLAUDE.md can't
 * blow the context window. Truncation is footnoted so the
 * agent knows to ask for more if it needs the tail.
 */

const MAX_BYTES = 16_000;

const PROJECT_FILENAMES = ["CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md"] as const;

export type LoadedProjectMemory = {
  /** Concatenated memory text, ready for system-prompt injection. */
  block: string;
  /** Which files contributed (for the banner / StatusBar). */
  sources: string[];
  /** True when the truncation footnote was added. */
  truncated: boolean;
};

export function loadProjectMemory(opts?: {
  cwd?: string;
  userHome?: string;
  /** Stop walking parents when this dir is reached (default: $HOME). */
  stopAt?: string;
}): LoadedProjectMemory {
  const cwd = opts?.cwd ?? process.cwd();
  const home = opts?.userHome ?? expandHome("~");
  const stopAt = opts?.stopAt ?? home;

  const sources: string[] = [];
  const parts: string[] = [];

  // 1. User-level first (lowest priority, but always available).
  const userLevel = path.join(home, ".m3", "CLAUDE.md");
  if (fs.existsSync(userLevel)) {
    const text = readCapped(userLevel);
    if (text) {
      parts.push(`## ~/.m3/CLAUDE.md\n\n${text}`);
      sources.push(userLevel);
    }
  }

  // 2. Walk up from cwd. At each level, read the first
  //    existing file from PROJECT_FILENAMES.
  let dir = path.resolve(cwd);
  const stop = path.resolve(stopAt);
  const seenDirs = new Set<string>();
  while (!seenDirs.has(dir)) {
    seenDirs.add(dir);
    for (const name of PROJECT_FILENAMES) {
      const fp = path.join(dir, name);
      if (fs.existsSync(fp)) {
        const text = readCapped(fp);
        if (text) {
          parts.push(`## ${name} (${dir})\n\n${text}`);
          sources.push(fp);
        }
        break; // first hit at this dir level wins
      }
    }
    if (dir === stop || dir === "/") break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const block = parts.join("\n\n");
  if (block.length <= MAX_BYTES) {
    return { block, sources, truncated: false };
  }
  return {
    block: `[…truncated to ${MAX_BYTES} bytes…]\n\n${block.slice(0, MAX_BYTES)}`,
    sources,
    truncated: true,
  };
}

function readCapped(fp: string): string {
  try {
    return fs.readFileSync(fp, "utf8");
  } catch {
    return "";
  }
}
