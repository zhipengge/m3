import os from "node:os";

export type SystemInfoPayload = {
  hostname: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  uptimeSec: number;
  loadAvg: number[];
  memory: {
    totalMb: number;
    freeMb: number;
    usedMb: number;
    usedPercent: number;
  };
  process: {
    pid: number;
    rssMb: number;
    heapUsedMb: number;
  };
  cpus: number;
};

export function collectSystemInfo(startedAt: number): SystemInfoPayload {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const mem = process.memoryUsage();
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    nodeVersion: process.version,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    loadAvg: os.loadavg(),
    memory: {
      totalMb: Math.round(total / 1024 / 1024),
      freeMb: Math.round(free / 1024 / 1024),
      usedMb: Math.round(used / 1024 / 1024),
      usedPercent: Math.round((used / total) * 100),
    },
    process: {
      pid: process.pid,
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    },
    cpus: os.cpus().length,
  };
}
