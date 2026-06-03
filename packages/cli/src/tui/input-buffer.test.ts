import { describe, expect, it } from "vitest";
import {
  backspaceAt,
  cursorEnd,
  deleteAt,
  insertChar,
  moveCursor,
} from "./input-buffer.js";

describe("input-buffer", () => {
  it("inserts at cursor", () => {
    expect(insertChar("ab", 1, "X")).toEqual({ text: "aXb", cursor: 2 });
  });

  it("backspaces before cursor", () => {
    expect(backspaceAt("abc", 2)).toEqual({ text: "ac", cursor: 1 });
  });

  it("deletes at cursor", () => {
    expect(deleteAt("abc", 1)).toEqual({ text: "ac", cursor: 1 });
  });

  it("moves cursor within bounds", () => {
    expect(moveCursor("hi", 1, -5)).toBe(0);
    expect(moveCursor("hi", 1, 5)).toBe(2);
    expect(cursorEnd("hi")).toBe(2);
  });
});
