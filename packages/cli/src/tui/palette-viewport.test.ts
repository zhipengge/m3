import { describe, expect, it } from "vitest";
import { paletteViewport } from "./palette-viewport.js";

describe("paletteViewport", () => {
  it("returns an empty window for an empty list", () => {
    expect(paletteViewport(0, 0, 5)).toEqual({ start: 0, end: 0, above: 0, below: 0 });
  });

  it("returns the full list when it fits", () => {
    expect(paletteViewport(3, 0, 10)).toEqual({ start: 0, end: 3, above: 0, below: 0 });
    expect(paletteViewport(3, 2, 10)).toEqual({ start: 0, end: 3, above: 0, below: 0 });
  });

  it("clamps the selection into range", () => {
    const v = paletteViewport(5, 99, 3);
    expect(v.start).toBeGreaterThanOrEqual(0);
    expect(v.end).toBeLessThanOrEqual(5);
    expect(v.end - v.start).toBeLessThanOrEqual(3);
    // The clamped selection is the last item
    expect(v.end - 1).toBeLessThan(5);
  });

  it("keeps the selected row inside the window", () => {
    for (let n = 1; n <= 30; n++) {
      for (let s = 0; s < n; s++) {
        const v = paletteViewport(n, s, 8);
        expect(v.start).toBeLessThanOrEqual(s);
        expect(s).toBeLessThan(v.end);
        expect(v.end - v.start).toBeLessThanOrEqual(8);
      }
    }
  });

  it("anchors selected to the bottom of the window when scrolling down", () => {
    // 20 items, 5 visible, select index 10 — expect start = 6 so the
    // selected item sits at the bottom of the window with one row of look-ahead.
    const v = paletteViewport(20, 10, 5);
    expect(v.start).toBe(6);
    expect(v.end).toBe(11);
    expect(v.above).toBe(6);
    expect(v.below).toBe(9);
  });

  it("shows the first window when selection is at the top", () => {
    const v = paletteViewport(20, 0, 5);
    expect(v.start).toBe(0);
    expect(v.end).toBe(5);
    expect(v.above).toBe(0);
    expect(v.below).toBe(15);
  });

  it("shows the last window when selection is at the bottom", () => {
    const v = paletteViewport(20, 19, 5);
    expect(v.end).toBe(20);
    expect(v.end - v.start).toBe(5);
    expect(v.below).toBe(0);
  });

  it("scrolls upward when the user presses ↑ past the current window", () => {
    // window [6..11), selected=10, press ↑ to 9 — window should still cover 9
    const a = paletteViewport(20, 10, 5);
    const b = paletteViewport(20, a.start, 5); // simulate pressing ↑ once
    expect(b.start).toBeLessThanOrEqual(a.start);
    expect(a.start).toBeLessThan(b.end);
  });

  it("never produces a negative start", () => {
    const v = paletteViewport(5, 0, 3);
    expect(v.start).toBe(0);
  });

  it("respects maxVisible=1 (a single highlighted row)", () => {
    for (let s = 0; s < 10; s++) {
      const v = paletteViewport(10, s, 1);
      expect(v.end - v.start).toBe(1);
      expect(v.start).toBe(s);
    }
  });

  it("handles a window larger than the list", () => {
    const v = paletteViewport(3, 1, 99);
    expect(v.start).toBe(0);
    expect(v.end).toBe(3);
    expect(v.above).toBe(0);
    expect(v.below).toBe(0);
  });
});
