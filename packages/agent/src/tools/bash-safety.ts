/**
 * Dangerous shell command detection. Returns a human-readable reason if the
 * command matches a known-risky pattern; null if it looks safe.
 *
 * The list is intentionally narrow: it catches accidents (rm -rf /, dd to
 * disk, fork bombs) and obvious exfiltration paths (curl | sh). It is NOT a
 * sandbox; the workspace policy + env allowlist remain the primary defense.
 */

export type BashSafetyVerdict =
  | { safe: true }
  | { safe: false; reason: string; pattern: string };

type CompiledRule = { re: RegExp; reason: string; id: string };

const RULES: CompiledRule[] = [
  {
    id: "rm-rf-root",
    re: /\brm\s+(-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*f[A-Za-z]*|-[A-Za-z]*f[A-Za-z]*r[A-Za-z]*f[A-Za-z]*|-rf|-fr)\s+\/(\s|$|\*)/,
    reason: "Recursive force-delete of root filesystem",
  },
  {
    id: "rm-rf-star",
    re: /\brm\s+(-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*f[A-Za-z]*|-[A-Za-z]*f[A-Za-z]*r[A-Za-z]*f[A-Za-z]*|-rf|-fr)\s+\*/,
    reason: "Recursive force-delete of wildcard (likely catastrophic)",
  },
  {
    id: "dd-disk",
    re: /\bdd\s+.*\bof=\/dev\/(disk|hd|sd|vd|nvme|rdisk)/,
    reason: "Writing raw data to a block device",
  },
  {
    id: "mkfs",
    re: /\bmkfs(\.\w+)?\s+\/dev\//,
    reason: "Formatting a filesystem on a block device",
  },
  {
    id: "forkbomb",
    re: /:\s*\(\s*\)\s*\{\s*:\|:&\s*\}\s*;\s*:/,
    reason: "Shell fork bomb",
  },
  {
    id: "curl-pipe-sh",
    re: /\bcurl\s+[^|]*\|\s*(sudo\s+)?(ba)?sh\b/,
    reason: "Piping a remote download directly into a shell",
  },
  {
    id: "wget-pipe-sh",
    re: /\bwget\s+[^|]*\|\s*(sudo\s+)?(ba)?sh\b/,
    reason: "Piping a remote download directly into a shell",
  },
  {
    id: "shutdown",
    re: /\b(shutdown|reboot|halt|poweroff)\b/,
    reason: "System power control command",
  },
  {
    id: "chmod-777",
    re: /\bchmod\s+(-[A-Za-z]*\s+)?7?77\s+\//,
    reason: "World-writable permissions on a system path",
  },
  {
    id: "write-etc-shadow",
    re: />\s*(\/etc\/(?:shadow|passwd|sudoers)|\/boot\/)/,
    reason: "Redirecting output to a system file",
  },
];

export function checkBashSafety(command: string): BashSafetyVerdict {
  for (const rule of RULES) {
    if (rule.re.test(command)) {
      return { safe: false, reason: rule.reason, pattern: rule.id };
    }
  }
  return { safe: true };
}

/** Export the rule ids for tests / display. */
export const BASH_SAFETY_RULE_IDS = RULES.map((r) => r.id);
