/**
 * Tiny code highlighter + diff renderer for the live TUI.
 *
 * Goals (kept deliberately small — this is a TUI, not an IDE):
 *   1. Tokenize a single line into keyword / string / number / comment /
 *      plain segments.
 *   2. Colorize the keywords common to JS/TS/Python/Go/Rust.
 *   3. Compute a small unified-style line diff from a small "before"
 *      and "after" string (used by the Edit tool's old_string /
 *      new_string fields).
 *
 * No dependency on a syntax-tree library — we just match a small
 * allow-list of keywords. This means highlighter mistakes on edge
 * cases are tolerable; the TUI's job is to show the user a clear
 * signal that a tool touched their code, not to be a perfect
 * highlighter. The full source is still in the audit log and the
 * transcript.
 */

// Common keywords across the languages m3 most often writes. The list
// is on the long side — false positives are far more tolerable
// than missing a real keyword in a diff the user is staring at.
const KEYWORDS = new Set([
  // JS / TS
  "function", "class", "const", "let", "var", "return", "if", "else",
  "for", "while", "do", "switch", "case", "break", "continue",
  "import", "export", "from", "as", "default", "async", "await",
  "new", "this", "super", "try", "catch", "finally", "throw",
  "typeof", "instanceof", "void", "delete", "in", "of", "yield",
  "interface", "type", "enum", "namespace", "declare", "abstract",
  "public", "private", "protected", "readonly", "static", "async",
  "implements", "extends", "with", "satisfies",
  // constants
  "true", "false", "null", "undefined", "None", "True", "False", "nil",
  // Python
  "def", "lambda", "elif", "yield", "global", "nonlocal", "pass",
  "raise", "with", "as", "is", "not", "and", "or", "in",
  "self", "cls",
  // Go
  "func", "package", "import", "defer", "select", "range", "chan",
  "go", "map", "struct", "interface", "fallthrough", "goto",
  // Rust
  "fn", "let", "mut", "pub", "use", "mod", "crate", "trait",
  "impl", "self", "ref", "match", "where", "unsafe", "as", "dyn",
  "move", "box",
  // SQL
  "SELECT", "FROM", "WHERE", "INSERT", "INTO", "VALUES", "UPDATE",
  "SET", "DELETE", "CREATE", "TABLE", "INDEX", "DROP", "ALTER",
  "JOIN", "ON", "AS", "AND", "OR", "NOT", "NULL", "IS", "IN",
  "LIKE", "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET",
  // Bash / shell
  "fi", "then", "elif", "done", "esac", "function", "export",
  "local", "readonly", "declare",
  // Common DSL / config keywords
  "true", "false", "yes", "no", "on", "off", "enabled", "disabled",
]);

type Token = { text: string; kind: "kw" | "str" | "num" | "cmt" | "fn" | "plain" };

/** Tokenize a single line. Cheap — a single forward pass. */
export function tokenize(line: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let buf = "";
  const flush = (kind: Token["kind"]) => {
    if (buf) {
      out.push({ text: buf, kind });
      buf = "";
    }
  };
  while (i < line.length) {
    const c = line[i]!;
    // Line comment (// …, # …)
    if (c === "/" && line[i + 1] === "/") {
      flush("plain");
      out.push({ text: line.slice(i), kind: "cmt" });
      i = line.length;
      continue;
    }
    if (c === "#" && !["(", " ", "\t", '"', "'", "`", ""].includes(line[i - 1] ?? "")) {
      flush("plain");
      out.push({ text: line.slice(i), kind: "cmt" });
      i = line.length;
      continue;
    }
    // String literal: "..." / '...' / `...`
    if (c === '"' || c === "'" || c === "`") {
      flush("plain");
      let j = i + 1;
      while (j < line.length) {
        const cc = line[j]!;
        if (cc === "\\" && j + 1 < line.length) {
          j += 2;
          continue;
        }
        if (cc === c) {
          j += 1;
          break;
        }
        j += 1;
      }
      out.push({ text: line.slice(i, j), kind: "str" });
      i = j;
      continue;
    }
    // Number literal
    if (/[0-9]/.test(c) && (i === 0 || /[^A-Za-z_0-9]/.test(line[i - 1] ?? ""))) {
      let j = i;
      while (j < line.length && /[0-9.xXbA-Fa-f_eE+-]/.test(line[j]!)) j += 1;
      flush("plain");
      out.push({ text: line.slice(i, j), kind: "num" });
      i = j;
      continue;
    }
    // Identifier — check if it's a keyword
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < line.length && /[A-Za-z0-9_$]/.test(line[j]!)) j += 1;
      const word = line.slice(i, j);
      // Match keywords case-sensitively for SQL (uppercase) and
      // case-insensitively for everything else.
      if (KEYWORDS.has(word) || KEYWORDS.has(word.toLowerCase())) {
        flush("plain");
        out.push({ text: word, kind: "kw" });
        i = j;
        continue;
      }
      // Mark function call sites: identifier immediately followed by `(`.
      // The call NAME itself is a plain identifier; we just mark the
      // trailing paren-less word as "fn" for a slight visual hint.
      // (We don't try to track whether it's actually a function —
      // that would need a parser.)
      if (line[j] === "(" && /[A-Za-z_]/.test(word[0]!)) {
        buf += word;
        i = j;
        continue;
      }
      buf += word;
      i = j;
      continue;
    }
    buf += c;
    i += 1;
  }
  flush("plain");
  return out;
}

export type DiffLine = {
  /** '-' for removed, '+' for added, ' ' for context. */
  op: "-" | "+" | " ";
  line: string;
  /** Optional 1-based line number from the source file. */
  oldNo?: number;
  newNo?: number;
};

/**
 * Line-level diff between two strings. For short inputs (≤200 lines
 * each) we use a real LCS so context lines around the change are
 * preserved; for larger inputs we just show the old block as
 * removed and the new block as added. Both are O(n·m) in the
 * small-input case and O(n+m) in the large-input case.
 */
export function lineDiff(oldStr: string, newStr: string, maxLines = 80): DiffLine[] {
  const oldLines = oldStr.length === 0 ? [] : oldStr.split("\n");
  const newLines = newStr.length === 0 ? [] : newStr.split("\n");
  if (oldLines.length + newLines.length > 400) {
    // Large inputs — skip LCS, just emit "all del then all add". Still
    // capped to maxLines for the TUI.
    const out: DiffLine[] = [];
    for (const line of oldLines) {
      out.push({ op: "-", line });
      if (out.length >= maxLines) return out;
    }
    for (const line of newLines) {
      out.push({ op: "+", line });
      if (out.length >= maxLines) return out;
    }
    return out;
  }

  // LCS DP
  const n = oldLines.length;
  const m = newLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i]![j] = oldLines[i - 1] === newLines[j - 1]
        ? (dp[i - 1]![j - 1]! + 1)
        : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  // Walk back to produce the edit script
  const ops: DiffLine[] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ op: " ", line: oldLines[i - 1]!, oldNo: i, newNo: j });
      i--; j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      ops.push({ op: "-", line: oldLines[i - 1]!, oldNo: i });
      i--;
    } else {
      ops.push({ op: "+", line: newLines[j - 1]!, newNo: j });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ op: "-", line: oldLines[i - 1]!, oldNo: i });
    i--;
  }
  while (j > 0) {
    ops.push({ op: "+", line: newLines[j - 1]!, newNo: j });
    j--;
  }
  ops.reverse();
  return ops.length > maxLines ? ops.slice(0, maxLines) : ops;
}
