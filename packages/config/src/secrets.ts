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

export function loadSecrets(secretsPath?: string): M3Secrets {
  const resolved = expandHome(secretsPath ?? DEFAULT_SECRETS_PATH);
  if (!fs.existsSync(resolved)) {
    return M3SecretsSchema.parse({});
  }
  try {
    const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
    return M3SecretsSchema.parse(raw);
  } catch {
    return M3SecretsSchema.parse({});
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
