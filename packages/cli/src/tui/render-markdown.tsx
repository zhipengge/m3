/**
 * Tiny markdown renderer for the live TUI.
 *
 * Goals (kept small — this is a TUI, not an IDE):
 *   1. **Bold** / *italic* / `inline code` render with semantic color.
 *   2. ```fenced``` code blocks render as separate lines with
 *      syntax highlighting (delegated to `code-highlight.ts`).
 *   3. ATX headers (# / ## / ###) become bold + dim indent.
 *   4. Bullet / ordered list items get a colored marker prefix.
 *   5. [text](url) renders as colored `text` (the URL is hidden for
 *      one-line parity; the user can still type the link verbatim).
 *   6. Paragraphs separated by blank lines render as separate
 *      visual blocks (margin-top).
 *
 * Algorithm: paragraph-first (split on \n\n), then for each
 * paragraph detect fence/header/list/regular mode, then for
 * each line scan inline spans (code, emphasis, link). O(N) total.
 *
 * The output is a list of `<Text>` segments (and `<Box>` for
 * paragraphs / code blocks). No raw HTML, no full CommonMark edge
 * cases — just the subset m3's models actually emit.
 */

import { Box, Text } from "ink";
import { tokenize } from "./code-highlight.js";
import { theme } from "./theme.js";
import { sliceVisible, truncateMiddle } from "./wrap.js";

const DISPLAY_CAP = 4000;

type Span =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; url: string };

type Line =
  | { kind: "blank" }
  | { kind: "header"; level: 1 | 2 | 3; text: string }
  | { kind: "bullet"; marker: "•" | string; text: string; ordered?: number }
  | { kind: "code"; text: string }
  | { kind: "text"; text: string };

/** Tokenize one block (paragraph) into typed lines. */
function parseLines(block: string): Line[] {
  const rawLines = block.split("\n");
  const out: Line[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i]!;
    if (line.trim() === "") {
      out.push({ kind: "blank" });
      i += 1;
      continue;
    }
    // Fenced code block: starts with ```, ends with ```
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i += 1;
      while (i < rawLines.length && !rawLines[i]!.trim().startsWith("```")) {
        buf.push(rawLines[i]!);
        i += 1;
      }
      // Skip the closing fence if present
      if (i < rawLines.length) i += 1;
      out.push({ kind: "code", text: buf.join("\n") + (lang ? `\n; lang=${lang}` : "") });
      continue;
    }
    // Heading
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length as 1 | 2 | 3;
      out.push({ kind: "header", level, text: heading[2]! });
      i += 1;
      continue;
    }
    // Unordered list
    const ul = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (ul) {
      out.push({ kind: "bullet", marker: "•", text: ul[1]! });
      i += 1;
      continue;
    }
    // Ordered list (1. / 2. / …)
    const ol = /^\s*(\d+)\.\s+(.+)$/.exec(line);
    if (ol) {
      out.push({ kind: "bullet", marker: `${ol[1]}.`, text: ol[2]!, ordered: Number(ol[1]) });
      i += 1;
      continue;
    }
    // Plain text
    out.push({ kind: "text", text: line });
    i += 1;
  }
  return out;
}

/** Tokenize one inline string into spans. Pure; deterministic. */
export function tokenizeInline(input: string): Span[] {
  const out: Span[] = [];
  let buf = "";
  let i = 0;
  const flushText = () => {
    if (buf) {
      out.push({ kind: "text", text: buf });
      buf = "";
    }
  };
  while (i < input.length) {
    const c = input[i]!;
    // Inline code: `...`
    if (c === "`") {
      const end = input.indexOf("`", i + 1);
      if (end > i) {
        flushText();
        out.push({ kind: "code", text: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Bold: **...**
    if (c === "*" && input[i + 1] === "*") {
      const end = input.indexOf("**", i + 2);
      if (end > i + 1) {
        flushText();
        out.push({ kind: "bold", text: input.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    // Italic: *...* (single-asterisk, not part of **)
    if (c === "*" && input[i + 1] !== "*") {
      const end = input.indexOf("*", i + 1);
      if (end > i) {
        flushText();
        out.push({ kind: "italic", text: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Italic: _..._
    if (c === "_" && input[i + 1] !== "_" && /[\s(,;:!?\[]/.test(input[i - 1] ?? " ")) {
      const end = input.indexOf("_", i + 1);
      if (end > i) {
        flushText();
        out.push({ kind: "italic", text: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Link: [text](url)
    if (c === "[" && input[i + 1] !== "]") {
      const close = input.indexOf("]", i + 1);
      if (close > i && input[close + 1] === "(") {
        const urlEnd = input.indexOf(")", close + 2);
        if (urlEnd > close) {
          flushText();
          out.push({
            kind: "link",
            text: input.slice(i + 1, close),
            url: input.slice(close + 2, urlEnd),
          });
          i = urlEnd + 1;
          continue;
        }
      }
    }
    buf += c;
    i += 1;
  }
  flushText();
  return out;
}

/** Render an inline-tokenized list of spans as a Text segment. */
function InlineSpans({ spans }: { spans: Span[] }) {
  return (
    <Text wrap="wrap">
      {spans.map((s, i) => {
        switch (s.kind) {
          case "text":
            return (
              <Text key={i}>{s.text}</Text>
            );
          case "bold":
            return (
              <Text key={i} bold color={theme.assistant}>
                {s.text}
              </Text>
            );
          case "italic":
            return (
              <Text key={i} italic color={theme.muted}>
                {s.text}
              </Text>
            );
          case "code":
            return (
              <Text key={i} color={theme.brand} inverse>
                {` ${s.text} `}
              </Text>
            );
          case "link":
            return (
              <Text key={i} color={theme.accent} underline>
                {s.text}
              </Text>
            );
        }
      })}
    </Text>
  );
}

/** Render a fenced code block with per-line syntax highlighting. */
function CodeBlock({ text, width }: { text: string; width?: number }) {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  // Inside the round border + paddingX=1, the usable content width
  // is `width - 4` (border = 2 cols, padding = 2 cols). When the
  // parent didn't pass `width` we let Ink fall back to the
  // natural terminal width — that path is fine, this is just a
  // belt-and-suspenders cap for very narrow panes.
  const contentWidth = width !== undefined ? Math.max(20, width - 4) : undefined;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginY={0}
      width={width}
    >
      {lines.map((line, i) => {
        const tokens = tokenize(line);
        // Middle-truncate *whole* long lines so a 200-char URL in
        // a comment doesn't push the entire block off-screen. When
        // truncated we render the visible slice as a single plain
        // text run — token-aligned colouring is impossible after
        // a middle cut, but the slice is rare enough (line wider
        // than the pane) that the loss is acceptable.
        const truncated = contentWidth !== undefined ? truncateMiddle(line, contentWidth) : line;
        if (truncated !== line) {
          return (
            <Text key={i} color={theme.muted}>
              {truncated}
            </Text>
          );
        }
        return (
          <Text key={i}>
            {tokens.map((t, j) => {
              let color: string;
              switch (t.kind) {
                case "kw":
                  color = theme.brand;
                  break;
                case "str":
                  color = theme.warn;
                  break;
                case "num":
                  color = theme.accent;
                  break;
                case "cmt":
                  color = theme.muted;
                  break;
                default:
                  color = theme.assistant;
              }
              return (
                <Text key={j} color={color}>
                  {t.text}
                </Text>
              );
            })}
          </Text>
        );
      })}
    </Box>
  );
}

/**
 * Render a chunk of model output as a sequence of paragraph Boxes.
 * Used by the assistant / system / error message rows.
 *
 * `width` is the visible column budget for the entire block (border
 * + padding excluded). When omitted, Ink falls back to the
 * terminal width. The block applies its own line-level slice so
 * a 4k char assistant reply can't cascade into O(N²) wrap math
 * during streaming.
 *
 * `streaming` adds an inline `▌` cursor at the very end of the
 * text run. The cursor is rendered *inside* the last paragraph
 * Box (not as a sibling) so Ink sees one continuous text run and
 * doesn't re-flow the layout on every delta. The previous
 * sibling-Text placement occasionally produced an extra blank
 * row at the tail of the streaming reply.
 */
export function MarkdownBlock({
  text,
  dim = false,
  width,
  streaming,
}: {
  text: string;
  dim?: boolean;
  width?: number;
  streaming?: boolean;
}) {
  const sliced = sliceVisible(text, { maxChars: DISPLAY_CAP, maxLines: 200, lineWidth: width });
  const truncated = text.length > DISPLAY_CAP
    ? sliced.display + "\n…(truncated, see transcript for full text)"
    : sliced.display;
  const blocks = truncated.split(/\n\s*\n/);
  // Index of the last *visible* (non-null) line in the final block.
  // The cursor rides that line so it appears at the natural end of
  // the assistant text. Without this, the cursor would attach to
  // the empty block separator and Ink would render a stray row.
  const lastBlockIdx = blocks.length - 1;
  const lastBlockLines = lastBlockIdx >= 0 ? parseLines(blocks[lastBlockIdx]!) : [];
  let lastLineIdx = -1;
  for (let i = lastBlockLines.length - 1; i >= 0; i--) {
    if (lastBlockLines[i]!.kind !== "blank") {
      lastLineIdx = i;
      break;
    }
  }
  return (
    <Box flexDirection="column" marginY={0} width={width}>
      {blocks.map((block, bi) => {
        const lines = parseLines(block);
        return (
          <Box key={bi} flexDirection="column" marginTop={bi > 0 ? 1 : 0} marginY={0}>
            {lines.map((line, li) => {
              const isLastLine = bi === lastBlockIdx && li === lastLineIdx;
              if (line.kind === "blank") return null;
              if (line.kind === "code") {
                return <CodeBlock key={li} text={line.text.replace(/; lang=.*$/, "")} width={width} />;
              }
              if (line.kind === "header") {
                const color =
                  line.level === 1
                    ? theme.accent
                    : line.level === 2
                      ? theme.system
                      : theme.muted;
                return (
                  <Text key={li} bold color={color} dimColor={dim}>
                    {line.text}
                  </Text>
                );
              }
              if (line.kind === "bullet") {
                return (
                  <Box key={li} gap={1} flexDirection="row">
                    <Text color={theme.accent} bold>
                      {line.marker}
                    </Text>
                    <InlineSpans spans={tokenizeInline(line.text)} />
                    {streaming && isLastLine ? (
                      <Text color={theme.accent}>▌</Text>
                    ) : null}
                  </Box>
                );
              }
              return (
                <Text key={li} dimColor={dim} wrap="wrap">
                  {line.text.startsWith(">") ? (
                    <>
                      <Text color={theme.muted}>▎ </Text>
                      <InlineSpans spans={tokenizeInline(line.text.slice(1).trimStart())} />
                      {streaming && isLastLine ? (
                        <Text color={theme.accent}>▌</Text>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <InlineSpans spans={tokenizeInline(line.text)} />
                      {streaming && isLastLine ? (
                        <Text color={theme.accent}>▌</Text>
                      ) : null}
                    </>
                  )}
                </Text>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
