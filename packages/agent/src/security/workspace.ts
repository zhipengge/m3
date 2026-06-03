import path from "node:path";

export type SandboxPolicy = {
  /** When true, file/command operations are confined to the workspace root. */
  enabled: boolean;
  /** When true, read-only tools may read files outside the workspace root. */
  allowReadOutside: boolean;
};

export const DEFAULT_SANDBOX: SandboxPolicy = {
  enabled: true,
  allowReadOutside: false,
};

export class SandboxViolationError extends Error {
  constructor(requested: string, root: string) {
    super(
      `Sandbox violation: "${requested}" resolves outside the workspace root "${root}". ` +
        `Set agent.sandbox.enabled=false to disable (not recommended).`,
    );
    this.name = "SandboxViolationError";
  }
}

/** Resolve a (possibly relative) path against the workspace root, rejecting traversal. */
export function resolveWithinWorkspace(
  root: string,
  requested: string,
  policy: SandboxPolicy,
  opts: { readOnly?: boolean } = {},
): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(resolvedRoot, requested);

  if (!policy.enabled) return resolved;
  if (opts.readOnly && policy.allowReadOutside) return resolved;

  const rel = path.relative(resolvedRoot, resolved);
  const escapes = rel.startsWith("..") || path.isAbsolute(rel);
  if (escapes) throw new SandboxViolationError(requested, resolvedRoot);
  return resolved;
}

/**
 * Env allowlist for child processes (Bash). Avoids leaking host secrets
 * (API keys, tokens) into arbitrary shell commands. PATH/HOME/locale are kept
 * so common tooling still works.
 */
const DEFAULT_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "PWD",
  "NODE_ENV",
];

export function buildSandboxedEnv(
  base: NodeJS.ProcessEnv,
  extraAllow: string[] = [],
): NodeJS.ProcessEnv {
  const allow = new Set([...DEFAULT_ENV_ALLOWLIST, ...extraAllow]);
  const out: NodeJS.ProcessEnv = {};
  for (const key of allow) {
    if (base[key] !== undefined) out[key] = base[key];
  }
  return out;
}
