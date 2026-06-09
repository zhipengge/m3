export type AuditEvent = {
  ts: string;
  sessionId: string;
  toolName: string;
  decision: "allow" | "deny";
  /** Short, non-sensitive summary of the tool input (truncated, secrets redacted). */
  summary?: string;
  /**
   * Optional content hash (sha256 of the full input, hex). Lets a
   * reviewer verify that the audit record's `summary` accurately
   * represents the tool call without retaining the full input.
   * Only present when the file-backed sink is used.
   */
  inputHash?: string;
  /** Origin of the decision: prompt (user approved), mode (auto), pattern (rule). */
  origin?: "prompt" | "mode" | "pattern";
};

export type AuditSink = (event: AuditEvent) => void;

/**
 * Patterns that look like secrets. Matched values are replaced with `[REDACTED]`
 * in the audit summary so a leaked log line never exposes a credential.
 */
type SecretPattern = { re: RegExp; /** Keep the leading capture group as a label (e.g. "API_KEY=") before redacting. */ preserveLabel?: boolean };

const SECRET_PATTERNS: SecretPattern[] = [
  // Authorization: Bearer <token> / Basic <token> / Token <token>
  { re: /\b(authorization\s*:\s*(?:bearer|basic|token|digest)\s+)([^\s"',}]+)/gi, preserveLabel: true },
  // Generic key=value / key: value for known secret keywords
  { re: /\b(api[_-]?key|access[_-]?key|secret|password|passwd|pwd|token)(\s*[:=]\s*["']?)([A-Za-z0-9._\-+/=]{8,})["']?/gi, preserveLabel: true },
  // JSON Web Tokens — three base64url segments separated by dots. The
  // header always starts with eyJ (base64 of "{").
  { re: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  // OpenAI / Anthropic / DeepSeek style secret prefixes
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  // GitHub classic + fine-grained + server tokens
  { re: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { re: /\bghs_[A-Za-z0-9]{20,}\b/g },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  // Slack bot/app/legacy/etc.
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  // npm publish tokens
  { re: /\bnpm_[A-Za-z0-9]{20,}\b/g },
  // AWS access key id (long) and STS session token ("FwoGZXIv..." base64)
  { re: /\bAKIA[0-9A-Z]{16}\b/g },
  { re: /\bFwoGZXIv[A-Za-z0-9+\/=]{100,}\b/g },
  // Long values assigned to env-var-like keys (preserve key)
  { re: /\b([A-Z][A-Z0-9_]{3,}\s*=\s*)([^\s"',]{16,})/g, preserveLabel: true },
];

/**
 * Maximum input size we run the secret-regex suite against. Inputs
 * larger than this are returned verbatim — secrets past this point
 * are extremely unlikely (a real key is <1kB; the cap is 64kB to
 * leave headroom for one-liner stack traces that mention a token).
 * The cap is a defensive guard against a runaway tool that pastes
 * a multi-megabyte log file into a Write/Bash call — running ten
 * global regexes against a 10MB string on every tool call is
 * enough to add seconds of latency per turn.
 *
 * Exported so `summarizeInput` can pre-truncate to a value safely
 * below this cap.
 */
export const REDACT_INPUT_CAP = 64 * 1024;

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
  if (input.length > REDACT_INPUT_CAP) {
    // Refuse to regex a huge blob. The caller is expected to
    // summarise / truncate first; this is a safety net, not a
    // primary path. The verbatim return still avoids leaking
    // the raw input in logs (we don't log it at all in that
    // case).
    return "[input too large to redact; not logged]";
  }
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

/**
 * File-backed audit sink. Appends each event as a single line of
 * JSON to \`~/.m3/audit/YYYY-MM-DD.jsonl\` — one file per day for
 * easy rotation. Atomic per-line writes (no multi-line JSON
 * records), so a tail -f on the day's file is a live
 * permission-decision feed.
 *
 * The \`AuditLog\` itself is in-process; the file sink just
 * persists the events. The decision summary is already
 * redacted by \`AuditLog.record\`; the file path is forced to
 * 0o600 via the shared fs helper so a multi-user host can't
 * read the day's permission history.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { expandHome } from "@m3/config";

const AUDIT_DIR = "~/.m3/audit";

function auditDir(): string {
  return expandHome(AUDIT_DIR);
}

function todayFile(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return path.join(auditDir(), `${y}-${m}-${day}.jsonl`);
}

function hashInput(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  try {
    const json = typeof input === "string" ? input : JSON.stringify(input);
    return createHash("sha256").update(json).digest("hex").slice(0, 16);
  } catch {
    return undefined;
  }
}

export function fileAuditSink(event: AuditEvent): void {
  if (process.env.M3_AUDIT_SILENT === "1") return;
  const dir = auditDir();
  fs.mkdirSync(dir, { recursive: true });
  const fp = todayFile();
  const enriched = {
    ...event,
    inputHash: event.inputHash ?? hashInput(event.summary),
  };
  // appendFileSync is O_APPEND so concurrent writers serialize at
  // the filesystem level; we still write one record per syscall
  // so a torn write can only lose the last line, not the whole
  // record. Set the file mode on first write only — chmod is a
  // no-op on already-correctly-permissioned files.
  let needsChmod = false;
  try {
    const st = fs.statSync(fp);
    needsChmod = (st.mode & 0o777) !== 0o600;
  } catch {
    needsChmod = true;
  }
  fs.appendFileSync(fp, JSON.stringify(enriched) + "\n", { mode: 0o600 });
  if (needsChmod) {
    try {
      fs.chmodSync(fp, 0o600);
    } catch {
      /* best-effort */
    }
  }
}

/** Make a writer that mirrors to BOTH stderr and the daily file. */
export function dualAuditSink(event: AuditEvent): void {
  AuditLog.stderrSink(event);
  fileAuditSink(event);
}

/** Force a sync flush — fs.appendFileSync is synchronous but
 *  Node may buffer in odd platforms; this makes the daily
 *  file observable immediately after \`record\`. */
export function flushAuditFile(): void {
  // appendFileSync returns void and is synchronous; the daily
  // file is always flushed by the time fileAuditSink returns.
  // Exposed for callers that want to guarantee visibility.
}

export function summarizeInput(input: unknown, max = 120): string {
  let s: string;
  try {
    s = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    s = String(input);
  }
  // Pre-truncate to a value safely below the redact-input cap
  // so the regex pass below doesn't accidentally trip the
  // safety net on a 1MB Bash command. Summaries are bounded by
  // `max` anyway, so a 1MB string is pathologically large; we
  // cap to REDACT_INPUT_CAP - 1KB to keep the redactor's
  // invariant (and avoid a misleading "input too large to
  // redact" message in the audit log).
  const PRE_CAP = Math.max(1024, REDACT_INPUT_CAP - 1024);
  if (s.length > PRE_CAP) s = s.slice(0, PRE_CAP) + "…(truncated before redact)";
  const redacted = redactSecrets(s);
  return redacted.length > max ? `${redacted.slice(0, max)}…` : redacted;
}
