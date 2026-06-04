import { spawn } from "node:child_process";
import { sniffImageMime } from "@m3/agent";

/**
 * Read an image off the OS clipboard. Currently macOS-only (the only
 * platform users have asked for so far). The implementation shells out to
 * `osascript` to dump the clipboard's «class PNGf» record as hex, then
 * `xxd -r -p` converts that hex to the raw PNG bytes. We probe the first
 * 12 bytes to confirm the bytes are a real image — osascript returns empty
 * data when the clipboard holds text, in which case we return null so the
 * TUI can show "no image on clipboard".
 *
 * Returns:
 *   - `{ data, mimeType, ext }` on success
 *   - `null` if the clipboard is empty, holds text, or the OS isn't macOS
 *
 * Throws only on catastrophic failures (e.g. osascript missing); transient
 * "no image" returns null.
 */
export type ClipboardImage = {
  data: Buffer;
  mimeType: string;
  ext: string;
};

const OSASCRIPT_BIN = "/usr/bin/osascript";
const XXD_BIN = "/usr/bin/xxd";

export async function readClipboardImage(): Promise<ClipboardImage | null> {
  if (process.platform !== "darwin") return null;
  try {
    // Dump the clipboard PNGf (if any) to stdout as hex.
    // The quoting here is intentional: the angle quotes are required by
    // AppleScript to refer to a four-char class code, and we wrap the
    // whole thing in a single -e so the shell doesn't interpret them.
    const script = `set theData to the clipboard as «class PNGf»
return theData`;
    const hex = await runCommand(OSASCRIPT_BIN, ["-e", script]);
    const trimmed = hex.trim();
    if (trimmed.length < 16) return null;
    const raw = await runCommand(XXD_BIN, ["-r", "-p"], { stdin: trimmed });
    const buf = Buffer.from(raw, "binary");
    const sniffed = sniffImageMime(buf);
    if (!sniffed) return null;
    return { data: buf, ...sniffed };
  } catch {
    return null;
  }
}

function runCommand(
  bin: string,
  args: string[],
  options: { stdin?: string } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} exited ${code}: ${stderr.trim()}`));
    });
    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}
