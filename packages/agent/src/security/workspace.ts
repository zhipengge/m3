import fs from "node:fs";
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

/** Walk parent directories until one exists; used to realpath a path
 *  whose final segment may not exist yet (e.g. a Write target). */
function realpathExistingPrefix(p: string): string {
  let cur = p;
  // Bounded — path components are finite. Bail when we hit root.
  for (let i = 0; i < 4096; i++) {
    if (fs.existsSync(cur)) {
      try {
        return fs.realpathSync(cur);
      } catch {
        return cur;
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) return cur;
    cur = parent;
  }
  return cur;
}

/**
 * Resolve a (possibly relative) path against the workspace root, rejecting
 * traversal. Also rejects paths that, after `realpath`, escape the root —
 * this catches `workspace/link -> /etc` symlink attacks that pure
 * string-path normalization misses.
 */
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

  // Symlink hardening. The string-path check above can be bypassed if
  // the workspace contains a symlink that points outside. We realpath
  // both sides and re-check the relationship. realpath the workspace
  // once (best-effort: a missing workspace root is the engine's
  // problem, not ours).
  try {
    const realRoot = fs.realpathSync(resolvedRoot);
    const realRequested = realpathExistingPrefix(resolved);
    const relReal = path.relative(realRoot, realRequested);
    const realEscapes = relReal.startsWith("..") || path.isAbsolute(relReal);
    if (realEscapes) throw new SandboxViolationError(requested, realRoot);
  } catch (err) {
    if (err instanceof SandboxViolationError) throw err;
    // fs.realpathSync on the root itself failed (e.g. workspace was
    // deleted between resolve and access). Fall through and let the
    // tool's own fs call report the real error.
  }
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

/**
 * Names matching these patterns are NEVER copied into the bash child
 * env, even when the user adds them to `agent.sandbox.bashEnvAllow`.
 * The goal is to prevent an agent (or a malicious tool result) from
 * exfiltrating API keys via `echo $M3_OPENAI_API_KEY` after a
 * typo/copy-paste in config opens a hole.
 */
const SECRET_NAME_BLOCKLIST = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)/i;

export function buildSandboxedEnv(
  base: NodeJS.ProcessEnv,
  extraAllow: string[] = [],
  opts: { onBlocked?: (name: string) => void } = {},
): NodeJS.ProcessEnv {
  const filteredExtras: string[] = [];
  for (const name of extraAllow) {
    if (SECRET_NAME_BLOCKLIST.test(name)) {
      opts.onBlocked?.(name);
      continue;
    }
    filteredExtras.push(name);
  }
  const allow = new Set([...DEFAULT_ENV_ALLOWLIST, ...filteredExtras]);
  const out: NodeJS.ProcessEnv = {};
  for (const key of allow) {
    if (base[key] !== undefined) out[key] = base[key];
  }
  return out;
}

export { SECRET_NAME_BLOCKLIST as BASH_ENV_SECRET_BLOCKLIST };
