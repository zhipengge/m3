import fs from "node:fs";
import { expandHome } from "@m3/config";

const DEFAULT_PID_PATH = "~/.m3/gateway.pid";

export function writeGatewayPid(port: number, bind: string, path = DEFAULT_PID_PATH): void {
  const resolved = expandHome(path);
  fs.mkdirSync(resolved.replace(/\/[^/]+$/, ""), { recursive: true });
  fs.writeFileSync(
    resolved,
    JSON.stringify({ pid: process.pid, port, bind, startedAt: new Date().toISOString() }, null, 2),
  );
}

export function readGatewayPid(path = DEFAULT_PID_PATH): {
  pid: number;
  port: number;
  bind: string;
  startedAt: string;
} | null {
  const resolved = expandHome(path);
  if (!fs.existsSync(resolved)) return null;
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as {
      pid: number;
      port: number;
      bind: string;
      startedAt: string;
    };
  } catch {
    return null;
  }
}

export function clearGatewayPid(path = DEFAULT_PID_PATH): void {
  const resolved = expandHome(path);
  if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
}
