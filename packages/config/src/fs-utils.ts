import fs from "node:fs";
import path from "node:path";

/**
 * File mode used for everything under `~/.m3/` that holds credentials or
 * machine-identifying data (m3.json, secrets.json, pairing.json,
 * transcripts/*.json). 0o600 means owner read/write only — on a multi-
 * user host, other users on the box can't read API keys, pairing
 * codes, or transcripts.
 */
export const SECRET_FILE_MODE = 0o600;

/**
 * Write `data` to `filePath` atomically: dump to a unique tmp file
 * adjacent to the target, then rename. A crash mid-write leaves the
 * tmp behind (best-effort cleanup) but the canonical file is
 * untouched, so the previous good copy is always readable.
 *
 * Also forces the file mode to `SECRET_FILE_MODE` (0o600) on Linux /
 * macOS. On Windows, `fs.chmodSync` is a no-op for some bits; the
 * call still succeeds but the effective ACL is unchanged. The mode
 * parameter exists so call sites that intentionally want a looser
 * mode (none today) can override.
 */
export function atomicWriteFileSync(
  filePath: string,
  data: string,
  opts: { mode?: number } = {},
): void {
  const mode = opts.mode ?? SECRET_FILE_MODE;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode });
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* tmp was never created */
    }
    throw err;
  }
}
