import { execSync } from "node:child_process";

export type PortUsage = {
  pid: number;
  command: string;
};

export function findProcessOnPort(port: number, host = "127.0.0.1"): PortUsage | null {
  try {
    const out = execSync(`lsof -n -P -iTCP:${port} -sTCP:LISTEN 2>/dev/null`, { encoding: "utf8" });
    const lines = out.trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[1]);
      const command = parts[0] ?? "unknown";
      const addr = parts.slice(-2).join(" ");
      if (!Number.isFinite(pid)) continue;
      if (host === "127.0.0.1" && !addr.includes("127.0.0.1") && !addr.includes("*")) continue;
      return { pid, command };
    }
  } catch {
    return null;
  }
  return null;
}

export function isPortInUse(port: number, host = "127.0.0.1"): boolean {
  return findProcessOnPort(port, host) !== null;
}

export function stopProcessOnPort(port: number, host = "127.0.0.1"): PortUsage | null {
  const usage = findProcessOnPort(port, host);
  if (!usage) return null;
  try {
    process.kill(usage.pid, "SIGTERM");
  } catch {
    return null;
  }
  return usage;
}

export class PortInUseError extends Error {
  constructor(
    readonly port: number,
    readonly bind: string,
    readonly usage: PortUsage | null,
  ) {
    const hint = usage
      ? `Port ${bind}:${port} is in use by ${usage.command} (pid ${usage.pid}). Run: m3 gateway stop`
      : `Port ${bind}:${port} is already in use. Run: m3 gateway stop`;
    super(hint);
    this.name = "PortInUseError";
  }
}
