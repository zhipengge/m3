export type LogEntry = {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
};

export class EventLog {
  private entries: LogEntry[] = [];

  constructor(private readonly maxSize = 200) {}

  append(level: LogEntry["level"], message: string): void {
    this.entries.push({ ts: new Date().toISOString(), level, message });
    if (this.entries.length > this.maxSize) {
      this.entries.splice(0, this.entries.length - this.maxSize);
    }
  }

  list(limit = 50): LogEntry[] {
    return this.entries.slice(-limit);
  }
}
