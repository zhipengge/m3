import { z } from "zod";
import { ModelsConfigSchema } from "./models.js";

export const GatewayConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(18790),
  bind: z.string().default("127.0.0.1"),
  /**
   * Bearer token required on the WebSocket control plane. When set, clients
   * must send it via the `Authorization: Bearer <token>` header or an
   * `?token=` query param. Recommended whenever bind is not loopback-only.
   */
  authToken: z.string().optional(),
  controlUi: z
    .object({
      enabled: z.boolean().default(true),
    })
    .optional(),
});

export const AgentConfigSchema = z.object({
  engine: z.enum(["native", "mock", "legacy-cli"]).default("native"),
  /** Model ref: provider/model e.g. deepseek/deepseek-chat */
  model: z.string().default("deepseek/deepseek-chat"),
  permissionMode: z
    .enum(["default", "acceptEdits", "bypassPermissions", "plan"])
    .default("default"),
  /** Feishu/Slack/WebChat inbound runs use this (default: bypassPermissions). */
  channelPermissionMode: z
    .enum(["default", "acceptEdits", "bypassPermissions", "plan"])
    .optional(),
  tools: z.union([z.literal("*"), z.array(z.string())]).default("*"),
  cwd: z.string().optional(),
  maxTurns: z.number().int().min(1).max(100).default(25),
  legacyCliCommand: z.string().default("claude"),
  mcp: z
    .object({
      /** Path to MCP config JSON (Claude Desktop `mcpServers` shape). */
      config: z.string().optional(),
      /** Inline MCP servers (merged with config file; inline wins on name clash). */
      servers: z.record(z.unknown()).optional(),
      /** Tool name prefix for MCP tools (default mcp__). */
      toolPrefix: z.string().default("mcp__"),
      bundleGatewayTools: z.boolean().default(false),
    })
    .optional(),
  skills: z
    .object({
      dirs: z.array(z.string()).default([]),
    })
    .optional(),
  planMode: z.boolean().default(false),
  subAgents: z
    .object({
      enabled: z.boolean().default(true),
      maxDepth: z.number().int().min(1).max(5).default(2),
    })
    .optional(),
  /** Workspace sandbox for file/command tools. Enabled by default for safety. */
  sandbox: z
    .object({
      enabled: z.boolean().default(true),
      allowReadOutside: z.boolean().default(false),
      /** Extra env var names exposed to Bash child processes. */
      bashEnvAllow: z.array(z.string()).default([]),
    })
    .default({}),
});

export const ChannelAccountSchema = z.record(
  z.object({
    enabled: z.boolean().default(true),
    appId: z.string().optional(),
    appSecret: z.string().optional(),
    botToken: z.string().optional(),
    /** Slack Socket Mode app-level token (xapp-). */
    appToken: z.string().optional(),
    signingSecret: z.string().optional(),
    /** Feishu event subscription encrypt key (optional). */
    encryptKey: z.string().optional(),
    /** Feishu URL verification token. */
    verificationToken: z.string().optional(),
    webhookPath: z.string().optional(),
    /** Dedicated port for channel webhook (Feishu); defaults to gateway.port + 1. */
    webhookPort: z.number().int().min(1).max(65535).optional(),
    /**
     * Feishu event transport: `long` = official WebSocket (recommended, no public URL);
     * `webhook` = HTTP callback (needs Verification Token + public URL).
     */
    connectionMode: z.enum(["long", "webhook"]).default("long"),
    dmPolicy: z.enum(["pairing", "open", "closed"]).default("pairing"),
    allowFrom: z.array(z.string()).default([]),
  }),
);

export const ChannelsConfigSchema = z.object({
  webchat: ChannelAccountSchema.optional(),
  feishu: ChannelAccountSchema.optional(),
  slack: ChannelAccountSchema.optional(),
  discord: z.record(z.unknown()).optional(),
  telegram: z.record(z.unknown()).optional(),
});

export const BindingSchema = z.object({
  channel: z.string(),
  peer: z.string().optional(),
  account: z.string().optional(),
  agent: z.string().default("coder"),
  workspace: z.string().optional(),
});

export const HooksConfigSchema = z.record(z.unknown()).optional();

export const M3ConfigSchema = z.object({
  $schema: z.literal("m3-config-v1").optional(),
  gateway: GatewayConfigSchema.default({}),
  models: ModelsConfigSchema.default({}),
  agent: AgentConfigSchema.default({}),
  channels: ChannelsConfigSchema.default({}),
  bindings: z.array(BindingSchema).default([]),
  hooks: HooksConfigSchema,
  session: z
    .object({
      dbPath: z.string().default("~/.m3/sessions.db"),
      dmScope: z.enum(["main", "per-peer", "per-channel-peer"]).default("per-peer"),
    })
    .optional(),
  plugins: z
    .object({
      allow: z.array(z.string()).optional(),
      entries: z.record(z.object({ enabled: z.boolean().default(true) })).optional(),
      /** ESM plugin entry files (.js/.mjs) exporting default M3Plugin. */
      paths: z.array(z.string()).default([]),
    })
    .optional(),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;
export type Binding = z.infer<typeof BindingSchema>;
export type M3Config = z.infer<typeof M3ConfigSchema>;

export { ModelsConfigSchema, type ModelsConfig, type ResolvedModel } from "./models.js";
export { M3SecretsSchema, type M3Secrets, loadSecrets, saveSecrets, secretsExists, DEFAULT_SECRETS_PATH } from "./secrets.js";
export { resolveModel } from "./resolve-model.js";

export const DEFAULT_CONFIG_PATH = "~/.m3/m3.json";

export function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return `${home}${path.slice(1)}`;
  }
  return path;
}
