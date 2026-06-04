import fs from "node:fs/promises";
import type { ImageSource } from "./types.js";

/** A pair of raw base64 (no `data:` prefix) and MIME type. */
export type ResolvedImage = { data: string; mimeType: string };

/**
 * Resolve an `ImageSource` into the base64 data + MIME the providers need.
 * - For `kind: "base64"` this is a passthrough (no disk I/O).
 * - For `kind: "path"` we read the file once and base64-encode it.
 *
 * No caching — providers call this once per LLM turn. The image payload
 * is small enough (a clipboard screenshot is typically < 500 KB) that
 * reading it per turn is fine, and avoids cache invalidation issues.
 */
export async function resolveImageSource(source: ImageSource): Promise<ResolvedImage> {
  if (source.kind === "base64") {
    return { data: source.data, mimeType: source.mimeType };
  }
  const buf = await fs.readFile(source.path);
  return { data: buf.toString("base64"), mimeType: source.mimeType };
}

/**
 * Probe the first few bytes of a buffer for image MIME sniffing. Used by
 * the clipboard-paste helper to confirm a non-empty clipboard image and
 * pick a sensible file extension.
 */
export function sniffImageMime(buf: Uint8Array): { mimeType: string; ext: string } | null {
  if (buf.length < 8) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { mimeType: "image/png", ext: ".png" };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: "image/jpeg", ext: ".jpg" };
  }
  // GIF: GIF87a / GIF89a
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) {
    return { mimeType: "image/gif", ext: ".gif" };
  }
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return { mimeType: "image/webp", ext: ".webp" };
  }
  return null;
}
