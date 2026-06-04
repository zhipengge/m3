import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { resolveImageSource, sniffImageMime } from "./image-source.js";

describe("sniffImageMime", () => {
  it("detects PNG", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageMime(png)).toEqual({ mimeType: "image/png", ext: ".png" });
  });

  it("detects JPEG", () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(sniffImageMime(jpg)).toEqual({ mimeType: "image/jpeg", ext: ".jpg" });
  });

  it("detects GIF87a and GIF89a", () => {
    expect(sniffImageMime(Buffer.from("GIF87a....", "binary"))?.mimeType).toBe("image/gif");
    expect(sniffImageMime(Buffer.from("GIF89a....", "binary"))?.mimeType).toBe("image/gif");
  });

  it("detects WebP", () => {
    const webp = Buffer.from("RIFF\x00\x00\x00\x00WEBP", "binary");
    expect(sniffImageMime(webp)).toEqual({ mimeType: "image/webp", ext: ".webp" });
  });

  it("returns null for non-image bytes", () => {
    expect(sniffImageMime(Buffer.from("hello world"))).toBeNull();
    expect(sniffImageMime(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
  });

  it("returns null for buffers shorter than the magic", () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

describe("resolveImageSource", () => {
  it("passes through base64 source unchanged", async () => {
    const out = await resolveImageSource({
      kind: "base64",
      data: "aGVsbG8=",
      mimeType: "image/png",
    });
    expect(out).toEqual({ data: "aGVsbG8=", mimeType: "image/png" });
  });

  it("reads path source from disk and base64-encodes it", async () => {
    const tmp = path.join(os.tmpdir(), `m3-img-${Math.random().toString(36).slice(2)}.png`);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    await fs.writeFile(tmp, pngHeader);
    try {
      const out = await resolveImageSource({ kind: "path", path: tmp, mimeType: "image/png" });
      expect(out.mimeType).toBe("image/png");
      expect(Buffer.from(out.data, "base64").equals(pngHeader)).toBe(true);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  });

  it("propagates file-read errors", async () => {
    await expect(
      resolveImageSource({
        kind: "path",
        path: "/nonexistent/path/to/missing.png",
        mimeType: "image/png",
      }),
    ).rejects.toThrow();
  });
});
