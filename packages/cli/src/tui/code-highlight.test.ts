import { describe, expect, it } from "vitest";
import { lineDiff, tokenize } from "./code-highlight.js";

describe("tokenize", () => {
  it("identifies keywords", () => {
    const tokens = tokenize("const x = 1;");
    const kw = tokens.filter((t) => t.kind === "kw");
    expect(kw.length).toBeGreaterThan(0);
    expect(kw[0]!.text).toBe("const");
  });

  it("identifies string literals", () => {
    const tokens = tokenize('const greeting = "hello world";');
    const str = tokens.filter((t) => t.kind === "str");
    expect(str.length).toBe(1);
    expect(str[0]!.text).toBe('"hello world"');
  });

  it("identifies single-quoted strings", () => {
    const tokens = tokenize("echo 'hi there' > /dev/null");
    const str = tokens.filter((t) => t.kind === "str");
    expect(str[0]!.text).toBe("'hi there'");
  });

  it("identifies backtick strings", () => {
    const tokens = tokenize("const t = `template ${x}`;");
    const str = tokens.filter((t) => t.kind === "str");
    expect(str[0]!.text.startsWith("`")).toBe(true);
  });

  it("identifies numbers", () => {
    const tokens = tokenize("const x = 42 + 3.14;");
    const num = tokens.filter((t) => t.kind === "num");
    expect(num.length).toBe(2);
    expect(num[0]!.text).toBe("42");
    expect(num[1]!.text).toBe("3.14");
  });

  it("identifies // line comments", () => {
    const tokens = tokenize("const x = 1; // trailing comment");
    const cmt = tokens.filter((t) => t.kind === "cmt");
    expect(cmt[0]!.text).toBe("// trailing comment");
  });

  it("handles empty lines", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([{ text: "   ", kind: "plain" }]);
  });

  it("case-insensitive keyword match for lowercase keywords", () => {
    const tokens = tokenize("function Foo() { return 1; }");
    const kw = tokens.filter((t) => t.kind === "kw");
    expect(kw.map((t) => t.text)).toContain("function");
    expect(kw.map((t) => t.text)).toContain("return");
  });

  it("highlights Python keywords", () => {
    const tokens = tokenize("def hello(self):\n    return None");
    const kw = tokens.filter((t) => t.kind === "kw");
    expect(kw.map((t) => t.text)).toEqual(
      expect.arrayContaining(["def", "self", "return", "None"]),
    );
  });

  it("highlights Rust keywords", () => {
    const tokens = tokenize("pub fn main() { let mut x = 0; }");
    const kw = tokens.filter((t) => t.kind === "kw");
    expect(kw.map((t) => t.text)).toEqual(
      expect.arrayContaining(["pub", "fn", "let", "mut"]),
    );
  });

  it("highlights SQL keywords", () => {
    const tokens = tokenize("SELECT id, name FROM users WHERE id = 1;");
    const kw = tokens.filter((t) => t.kind === "kw");
    expect(kw.map((t) => t.text)).toEqual(
      expect.arrayContaining(["SELECT", "FROM", "WHERE"]),
    );
  });

  it("highlights access modifiers (TS/Java)", () => {
    const tokens = tokenize("class Foo { private readonly x: number; }");
    const kw = tokens.filter((t) => t.kind === "kw");
    expect(kw.map((t) => t.text)).toEqual(
      expect.arrayContaining(["class", "private", "readonly"]),
    );
  });
});

describe("lineDiff", () => {
  it("returns context lines for identical input", () => {
    const out = lineDiff("a\nb\nc", "a\nb\nc");
    expect(out.every((l) => l.op === " ")).toBe(true);
    expect(out).toHaveLength(3);
  });

  it("marks insertions with + and old with -", () => {
    const out = lineDiff("a\nb", "a\nb\nc");
    expect(out.filter((l) => l.op === "+").map((l) => l.line)).toEqual(["c"]);
    expect(out.filter((l) => l.op === "-").map((l) => l.line)).toEqual([]);
  });

  it("marks deletions with -", () => {
    const out = lineDiff("a\nb\nc", "a\nc");
    expect(out.find((l) => l.op === "-")?.line).toBe("b");
  });

  it("marks replacement as del+add", () => {
    const out = lineDiff("const x = 1;", "const x = 42;");
    expect(out.find((l) => l.op === "-" && l.line === "const x = 1;")).toBeDefined();
    expect(out.find((l) => l.op === "+" && l.line === "const x = 42;")).toBeDefined();
  });

  it("caps output to maxLines", () => {
    const old = Array.from({ length: 100 }, (_, i) => `old${i}`).join("\n");
    const next = Array.from({ length: 100 }, (_, i) => `new${i}`).join("\n");
    const out = lineDiff(old, next, 10);
    expect(out.length).toBe(10);
  });

  it("preserves line numbers", () => {
    const out = lineDiff("a\nb\nc", "a\nB\nc");
    // 3rd line (index 2) changes from "b" to "B"
    expect(out.find((l) => l.op === "-")?.oldNo).toBe(2);
    expect(out.find((l) => l.op === "+")?.newNo).toBe(2);
  });

  it("handles empty old (write/all-add)", () => {
    const out = lineDiff("", "a\nb");
    expect(out.every((l) => l.op === "+")).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("handles empty new (delete/all-removal)", () => {
    const out = lineDiff("a\nb", "");
    expect(out.every((l) => l.op === "-")).toBe(true);
    expect(out).toHaveLength(2);
  });
});
