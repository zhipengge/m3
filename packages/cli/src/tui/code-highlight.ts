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
// is small on purpose — fewer false positives, and the colors are
// keyed so the user can scan a diff fast.
const KEYWORDS = new Set([
  // JS / TS
  "function", "class", "const", "let", "var", "return", "if", "else",
  "for", "while", "do", "switch", "case", "break", "continue",
  "import", "export", "from", "as", "default", "async", "await",
  "new", "this", "super", "try", "catch", "finally", "throw",
  "typeof", "instanceof", "void", "delete", "in", "of", "yield",
  "interface", "type", "enum", "namespace", "declare",
  "true", "false", "null", "undefined", "async",
  // Python / Go / Rust common
  "fn", "def", "class", "struct", "trait", "impl", "pub", "use",
  "let", "const", "static", "mut", "ref", "match", "mod", "crate",
  "func", "package", "import", "nil", "None", "True", "False",
  "self", "Self",
  // Go
  "chan", "go", "defer", "select", "range", "map",
  // SQL-ish
  "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE",
  // Bash
  "if", "fi", "then", "else", "elif", "for", "do", "done",
  "function", "export",
]);

type Token = { text: string; kind: "kw" | "str" | "num" | "cmt" | "plain" };

/** Tokenize a single line. Cheap — a single regex sweep. */
export function tokenize(line: string): Token[] {
  const out: Token[] = [];
  // Walk the line, slicing out comments and strings first (they take
  // priority over keyword matching).
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
    // Line comment
    if (c === "/" && line[i + 1] === "/") {
      flush("plain");
      out.push({ text: line.slice(i), kind: "cmt" });
      i = line.length;
      continue;
    }
    if (c === "#" && !["(", " ", "\t", '"', "'", "`"].includes(line[i - 1] ?? "")) {
      // Python / shell style — but only if preceded by whitespace-ish,
      // to avoid false-positive on `#` inside strings.
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
    // Number
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
      if (KEYWORDS.has(word) || KEYWORDS.has(word.toLowerCase())) {
        flush("plain");
        out.push({ text: word, kind: "kw" });
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
