export type AuditEvent = {
  ts: string;
  sessionId: string;
  toolName: string;
  decision: "allow" | "deny";
  /** Short, non-sensitive summary of the tool input (truncated). */
  summary?: string;
};

export type AuditSink = (event: AuditEvent) => void;

/**
 * Structured audit trail for tool permission decisions. Default sink writes a
 * single-line JSON record to stderr so it can be collected without polluting
 * the agent's stdout stream.
 */
export class AuditLog {
  constructor(private readonly sink: AuditSink = AuditLog.stderrSink) {}

  record(event: Omit<AuditEvent, "ts">): void {
    this.sink({ ...event, ts: new Date().toISOString() });
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
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
