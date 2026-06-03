import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { createAgentEngine } from "@m3/agent";
import {
  createMessagePipeline,
  createPermissionHandler,
  PairingStore,
  PermissionBridge,
  SessionMapper,
} from "@m3/bridge";
import { registerBundledChannels } from "@m3/channel-extensions";
import { loadM3PluginsFromConfig } from "@m3/plugin-sdk";
import type { InboundMessage } from "@m3/channels";
import type { M3Config } from "@m3/config";
import { resolveAgentWorkspace } from "@m3/config";
import { prepareInferenceBackend } from "@m3/local";
import {
  GATEWAY_PROTOCOL_VERSION,
  type AgentRequestParams,
  type GatewayFrame,
  type GatewayRequestFrame,
  type GatewayResponseFrame,
  GatewayMethods,
} from "@m3/gateway-protocol";
import type { SessionMapping } from "@m3/bridge";
import { ChannelManager } from "./channel-manager.js";
import { handleControlHttp } from "./control-ui.js";
import { collectSystemInfo } from "./system-info.js";
import { EventLog } from "./event-log.js";
import { clearGatewayPid, writeGatewayPid } from "./pid-file.js";
import { PortInUseError, findProcessOnPort } from "./port-utils.js";

export type GatewayServerOptions = {
  config: M3Config;
  mockAgent?: boolean;
};

export class GatewayServer {
  private httpServer?: http.Server;
  private wss?: WebSocketServer;
  private channelManager?: ChannelManager;
  private sessionMapper: SessionMapper;
  private permissionBridge: PermissionBridge;
  private startedAt = Date.now();
  private runCounter = 0;
  private readonly eventLog = new EventLog();
  private readonly pairingStore = new PairingStore();

  constructor(private readonly options: GatewayServerOptions) {
    registerBundledChannels();
    const dbPath = options.config.session?.dbPath ?? "~/.m3/sessions.json";
    this.sessionMapper = new SessionMapper(dbPath);
    this.permissionBridge = new PermissionBridge(options.config.agent);
  }

  async start(): Promise<{ url: string }> {
    const { bind, port } = this.options.config.gateway;
    const plugins = await loadM3PluginsFromConfig(this.options.config);
    if (plugins.pluginIds.length > 0) {
      console.log(
        `[m3] plugins: ${plugins.pluginIds.join(", ")} (tools: ${plugins.toolNames.length}, commands: ${plugins.commandNames.length})`,
      );
    }

    if (!this.options.mockAgent) {
      await prepareInferenceBackend(this.options.config);
    }

    const engine = createAgentEngine({
      config: this.options.config.agent,
      m3Config: this.options.config,
      mock: this.options.mockAgent,
    });

    const pipeline = createMessagePipeline({
      config: this.options.config,
      engine,
      sessionMapper: this.sessionMapper,
      permissionBridge: this.permissionBridge,
      pairingStore: this.pairingStore,
      onLog: (level, message) => this.eventLog.append(level, message),
      mock: this.options.mockAgent,
    });

    this.channelManager = new ChannelManager(this.options.config, (msg) =>
      pipeline.handleInbound(msg),
    );
    await this.channelManager.startAll();

    const controlEnabled = this.options.config.gateway.controlUi?.enabled !== false;
    this.httpServer = http.createServer((req, res) => {
      const url = req.url?.split("?")[0] ?? "";
      if (url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            version: GATEWAY_PROTOCOL_VERSION,
            uptimeMs: Date.now() - this.startedAt,
            channels: this.getChannelSnapshots(),
            sessions: this.listSessions().length,
          }),
        );
        return;
      }
      if (controlEnabled) {
        const handled = handleControlHttp(req, res, {
          startedAt: this.startedAt,
          version: GATEWAY_PROTOCOL_VERSION,
          getChannels: () => this.getChannelSnapshots(),
          getSessions: () => this.listSessions(),
          getSystem: () => collectSystemInfo(this.startedAt),
          getLogs: () => this.eventLog.list(80),
          getPairings: () => this.pairingStore.list(),
        });
        if (handled) return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    const authToken = this.options.config.gateway.authToken;
    this.wss = new WebSocketServer({
      server: this.httpServer,
      verifyClient: authToken
        ? (info, done) => {
            const ok = verifyGatewayToken(info.req, authToken);
            done(ok, ok ? undefined : 401, "Unauthorized");
          }
        : undefined,
    });

    this.wss.on("connection", (ws) => {
      ws.on("message", (data) => {
        void this.handleWsMessage(ws, data.toString());
      });
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.httpServer!;
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("error", onError);
        if (err.code === "EADDRINUSE") {
          reject(new PortInUseError(port, bind, findProcessOnPort(port, bind)));
          return;
        }
        reject(err);
      };
      server.once("error", onError);
      server.listen(port, bind, () => {
        server.off("error", onError);
        resolve();
      });
    });

    writeGatewayPid(port, bind);
    this.eventLog.append("info", `gateway started ${bind}:${port}`);
    const cwd = resolveAgentWorkspace(this.options.config.agent);
    console.log(`[m3] workspace: ${cwd}`);

    return { url: `ws://${bind}:${port}` };
  }

  async stop(): Promise<void> {
    clearGatewayPid();
    await this.channelManager?.stopAll();
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      this.httpServer?.close(() => resolve());
    });
  }

  getPermissionBridge(): PermissionBridge {
    return this.permissionBridge;
  }

  async dispatchInbound(message: InboundMessage): Promise<void> {
    const engine = createAgentEngine({
      config: this.options.config.agent,
      m3Config: this.options.config,
      mock: this.options.mockAgent,
    });
    const pipeline = createMessagePipeline({
      config: this.options.config,
      engine,
      sessionMapper: this.sessionMapper,
      permissionBridge: this.permissionBridge,
    });
    await pipeline.handleInbound(message);
  }

  getChannelSnapshots() {
    return this.channelManager?.getSnapshots() ?? [];
  }

  listSessions(): SessionMapping[] {
    return this.sessionMapper.list();
  }

  private async handleWsMessage(ws: WebSocket, raw: string): Promise<void> {
    let frame: GatewayRequestFrame;
    try {
      frame = JSON.parse(raw) as GatewayRequestFrame;
    } catch {
      return;
    }
    if (frame.type !== "req") return;

    const respond = (res: GatewayResponseFrame) => {
      ws.send(JSON.stringify(res));
    };

    switch (frame.method) {
      case GatewayMethods.HEALTH:
        respond({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            ok: true,
            version: GATEWAY_PROTOCOL_VERSION,
            uptimeMs: Date.now() - this.startedAt,
          },
        });
        break;
      case GatewayMethods.CHANNELS_STATUS:
        respond({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            channels: this.getChannelSnapshots(),
          },
        });
        break;
      case GatewayMethods.AGENT: {
        const params = frame.params as AgentRequestParams;
        const runId = `run-${++this.runCounter}`;
        respond({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { runId, acceptedAt: new Date().toISOString() },
        });
        void this.runAgentWs(ws, runId, params);
        break;
      }
      default:
        respond({
          type: "res",
          id: frame.id,
          ok: false,
          error: { code: "METHOD_NOT_FOUND", message: `Unknown method: ${frame.method}` },
        });
    }
  }

  private async runAgentWs(ws: WebSocket, runId: string, params: AgentRequestParams): Promise<void> {
    const engine = createAgentEngine({
      config: this.options.config.agent,
      m3Config: this.options.config,
      mock: this.options.mockAgent,
    });
    const emit = (payload: unknown) => {
      const event: GatewayFrame = { type: "event", event: "agent.stream", payload: { runId, ...payload as object } };
      ws.send(JSON.stringify(event));
    };

    emit({ stream: "lifecycle", phase: "start" });
    for await (const evt of engine.run({
      prompt: params.message,
      cwd: params.workspace,
      permissionHandler: createPermissionHandler(this.permissionBridge),
    })) {
      if (evt.type === "assistant_delta") {
        emit({ stream: "assistant", delta: evt.delta });
      } else if (evt.type === "tool_use") {
        emit({ stream: "tool", toolName: evt.name });
      } else if (evt.type === "lifecycle") {
        emit({ stream: "lifecycle", phase: evt.phase, error: evt.error });
      }
    }
    emit({ stream: "lifecycle", phase: "end" });
  }
}

export async function createGatewayServer(options: GatewayServerOptions): Promise<GatewayServer> {
  return new GatewayServer(options);
}

/** Validate the gateway bearer token from the Authorization header or ?token= query. */
export function verifyGatewayToken(req: http.IncomingMessage, expected: string): boolean {
  const header = req.headers["authorization"];
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    if (header.slice(7) === expected) return true;
  }
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.searchParams.get("token") === expected) return true;
  } catch {
    // malformed URL
  }
  return false;
}
