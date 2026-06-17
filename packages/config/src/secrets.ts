import fs from "node:fs";
import { z } from "zod";
import { expandHome } from "./schema.js";
import { atomicWriteFileSync } from "./fs-utils.js";

export const DEFAULT_SECRETS_PATH = "~/.m3/secrets.json";

/** Secrets are stored separately from m3.json — similar separation to CC auth vs settings */
export const M3SecretsSchema = z.object({
  providers: z
    .record(
      z.object({
        apiKey: z.string().min(1).optional(),
      }),
    )
    .default({}),
});

export type M3Secrets = z.infer<typeof M3SecretsSchema>;

export class SecretsParseError extends Error {
  readonly path: string;
  readonly cause: unknown;
  constructor(path: string, cause: unknown) {
    super(
      `Failed to parse ${path}: ${cause instanceof Error ? cause.message : String(cause)}. ` +
        `Fix the JSON or delete the file to start fresh (existing keys will be lost).`,
    );
    this.name = "SecretsParseError";
    this.path = path;
    this.cause = cause;
  }
}

export type LoadSecretsOptions = {
  /**
   * When false (default), parse errors throw `SecretsParseError` so the
   * caller can show a friendly error instead of silently dropping the
   * user's keys. Set true for read-only consumers that genuinely want
   * empty defaults on corruption.
   */
  tolerant?: boolean;
  /** Called for non-fatal warnings (permission too loose, etc.). */
  onWarning?: (msg: string) => void;
};

export function loadSecrets(
  secretsPath?: string,
  options: LoadSecretsOptions = {},
): M3Secrets {
  const resolved = expandHome(secretsPath ?? DEFAULT_SECRETS_PATH);
  if (!fs.existsSync(resolved)) {
    return M3SecretsSchema.parse({});
  }
  try {
    const st = fs.statSync(resolved);
    // 0o077 = group + others bits. On a multi-user host a 0644
    // secrets.json leaks API keys to every account. We warn but
    // don't refuse — refusing would brick installs whose install
    // script ran with a different umask.
    if (process.platform !== "win32" && (st.mode & 0o077) !== 0) {
      options.onWarning?.(
        `${resolved} has loose permissions (mode ${(st.mode & 0o777).toString(8)}). Run: chmod 600 ${resolved}`,
      );
    }
  } catch {
    /* stat failed; let readFileSync surface the real error */
  }
  let text: string;
  try {
    text = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    if (options.tolerant) return M3SecretsSchema.parse({});
    throw new SecretsParseError(resolved, err);
  }
  try {
    const raw = JSON.parse(text) as unknown;
    return M3SecretsSchema.parse(raw);
  } catch (err) {
    if (options.tolerant) return M3SecretsSchema.parse({});
    throw new SecretsParseError(resolved, err);
  }
}

export function saveSecrets(secrets: M3Secrets, secretsPath?: string): void {
  const resolved = expandHome(secretsPath ?? DEFAULT_SECRETS_PATH);
  // Atomic write at 0o600. A crash mid-write would otherwise leave a
  // partial JSON file that Zod rejects → loadSecrets returns {} →
  // the next save overwrites the user's real secrets with the empty
  // parsed defaults. Atomic + the explicit mode prevents both.
  atomicWriteFileSync(resolved, JSON.stringify(secrets, null, 2));
}

export function secretsExists(secretsPath?: string): boolean {
  return fs.existsSync(expandHome(secretsPath ?? DEFAULT_SECRETS_PATH));
}

export const M3SecretsExample = {
  providers: {
    deepseek: { apiKey: "sk-your-deepseek-key" },
    anthropic: { apiKey: "sk-ant-your-key" },
  },
} as const;

/**
 * Heuristic placeholder detector for API keys. `doctor` and the
 * first-call error path use this so a user who never edited
 * secrets.json sees a clear "replace the example value" error
 * instead of a generic 401 from the provider.
 */
const PLACEHOLDER_PATTERNS = [
  /your[-_]/i,
  /^sk-(your|example|placeholder|test|xxx)/i,
  /^sk-ant-your/i,
  /^(your|example|placeholder|changeme|todo|fix[-_]?me|xxx+)$/i,
  /placeholder/i,
  /\bexample\b/i,
];

export function looksLikePlaceholderKey(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return false;
  const trimmed = value.trim();
  if (!trimmed) return true; // configured but empty == placeholder
  if (trimmed.length < 12) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
}
