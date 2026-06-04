export type AuditEvent = {
  ts: string;
  sessionId: string;
  toolName: string;
  decision: "allow" | "deny";
  /** Short, non-sensitive summary of the tool input (truncated, secrets redacted). */
  summary?: string;
};

export type AuditSink = (event: AuditEvent) => void;

/**
 * Patterns that look like secrets. Matched values are replaced with `[REDACTED]`
 * in the audit summary so a leaked log line never exposes a credential.
 */
type SecretPattern = { re: RegExp; /** Keep the leading capture group as a label (e.g. "API_KEY=") before redacting. */ preserveLabel?: boolean };

const SECRET_PATTERNS: SecretPattern[] = [
  // Authorization: Bearer <token> / Basic <token> / Token <token>
  { re: /\b(authorization\s*:\s*(?:bearer|basic|token)\s+)([^\s"',}]+)/gi, preserveLabel: true },
  // Generic key=value / key: value for known secret keywords
  { re: /\b(api[_-]?key|access[_-]?key|secret|password|passwd|pwd|token)(\s*[:=]\s*["']?)([A-Za-z0-9._\-+/=]{8,})["']?/gi, preserveLabel: true },
  // Common API key prefixes
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { re: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { re: /\bAKIA[0-9A-Z]{16}\b/g },
  // Long values assigned to env-var-like keys (preserve key)
  { re: /\b([A-Z][A-Z0-9_]{3,}\s*=\s*)([^\s"',]{16,})/g, preserveLabel: true },
];

/**
 * Replace any substrings that look like credentials with `[REDACTED]`. Order
 * matters: more specific patterns run first so a prefix like "sk-..." is
 * caught before the generic env-var fallback.
 *
 * When `preserveLabel` is true the first two capture groups are concatenated
 * (keyword + separator) to form the visible prefix — e.g. "API_KEY=" — so
 * the redacted output still tells the operator which field was scrubbed.
 */
export function redactSecrets(input: string): string {
  let out = input;
  for (const { re, preserveLabel } of SECRET_PATTERNS) {
    out = out.replace(re, (match, ...groups) => {
      if (preserveLabel) {
        const label =
          (typeof groups[0] === "string" ? groups[0] : "") +
          (typeof groups[1] === "string" ? groups[1] : "");
        if (label.length > 0 && label.length < match.length) {
          return `${label}[REDACTED]`;
        }
      }
      return "[REDACTED]";
    });
  }
  return out;
}

/**
 * Structured audit trail for tool permission decisions. Default sink writes a
 * single-line JSON record to stderr so it can be collected without polluting
 * the agent's stdout stream.
 */
export class AuditLog {
  constructor(private readonly sink: AuditSink = AuditLog.stderrSink) {}

  record(event: Omit<AuditEvent, "ts">): void {
    const redacted = event.summary
      ? { ...event, summary: redactSecrets(event.summary) }
      : event;
    this.sink({ ...redacted, ts: new Date().toISOString() });
  }

  static stderrSink: AuditSink = (event) => {
    if (process.env.M3_AUDIT_SILENT === "1") return;
    process.stderr.write(`[m3:audit] ${JSON.stringify(event)}\n`);
  };
}

export function summarizeInput(input: unknown, max = 120): string {
  let s: string;
  try {
    s = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    s = String(input);
  }
  const redacted = redactSecrets(s);
  return redacted.length > max ? `${redacted.slice(0, max)}…` : redacted;
}
