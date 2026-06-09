import { describe, expect, it } from "vitest";
import { tokenizeInline } from "./render-markdown.js";
import { tokenize as codeTokenize } from "./code-highlight.js";

describe("tokenizeInline", () => {
  it("emits plain text for unmarked input", () => {
    const spans = tokenizeInline("hello world");
    expect(spans).toEqual([{ kind: "text", text: "hello world" }]);
  });

  it("parses **bold**", () => {
    const spans = tokenizeInline("a **b** c");
    expect(spans).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " c" },
    ]);
  });

  it("parses *italic*", () => {
    const spans = tokenizeInline("a *b* c");
    expect(spans).toEqual([
      { kind: "text", text: "a " },
      { kind: "italic", text: "b" },
      { kind: "text", text: " c" },
    ]);
  });

  it("parses `inline code`", () => {
    const spans = tokenizeInline("use `pnpm test`");
    expect(spans).toEqual([
      { kind: "text", text: "use " },
      { kind: "code", text: "pnpm test" },
    ]);
  });

  it("parses [text](url) and keeps the URL", () => {
    const spans = tokenizeInline("see [docs](https://example.com)");
    expect(spans).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "docs", url: "https://example.com" },
    ]);
  });

  it("handles unbalanced markers by leaving them as text", () => {
    const spans = tokenizeInline("a ` b");
    expect(spans).toEqual([{ kind: "text", text: "a ` b" }]);
  });

  it("mixes bold + code in one line", () => {
    const spans = tokenizeInline("use **bold** then `code`");
    expect(spans).toEqual([
      { kind: "text", text: "use " },
      { kind: "bold", text: "bold" },
      { kind: "text", text: " then " },
      { kind: "code", text: "code" },
    ]);
  });

  it("recognises _italic_ with a preceding space", () => {
    const spans = tokenizeInline("hello _world_");
    expect(spans).toEqual([
      { kind: "text", text: "hello " },
      { kind: "italic", text: "world" },
    ]);
  });
});

describe("code-highlight tokenize (used inside fenced blocks)", () => {
  it("identifies JS keywords and numbers", () => {
    const tokens = codeTokenize("const x = 42;");
    expect(tokens.some((t) => t.kind === "kw" && t.text === "const")).toBe(true);
    expect(tokens.some((t) => t.kind === "num" && t.text === "42")).toBe(true);
  });

  it("identifies Python keywords", () => {
    const tokens = codeTokenize("def hello(self):\n    return None");
    const kw = tokens.filter((t) => t.kind === "kw");
    expect(kw.map((t) => t.text)).toEqual(
      expect.arrayContaining(["def", "self", "return", "None"]),
    );
  });
});
