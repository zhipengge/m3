import {
  configExists,
  loadConfig,
  resolveConfigPath,
  saveConfig,
  type M3Config,
} from "@m3/config";
import {
  ask,
  askChoice,
  askNumber,
  askYesNo,
  closePrompt,
  createPrompt,
} from "./prompt.js";

type ChannelKind = "webchat" | "feishu" | "slack";

type ChannelAccount = {
  enabled?: boolean;
  connectionMode?: "long" | "webhook";
  appId?: string;
  appSecret?: string;
  botToken?: string;
  appToken?: string;
  signingSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
  webhookPath?: string;
  webhookPort?: number;
  dmPolicy?: "pairing" | "open" | "closed";
  allowFrom?: string[];
};

function maskSecret(value: string | undefined): string {
  if (!value) return "(not set)";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseAllowFrom(raw: string, current: string[]): string[] {
  if (!raw) return current;
  if (raw === "*") return ["*"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function promptAllowFrom(
  rl: ReturnType<typeof createPrompt>,
  current: string[],
): Promise<string[]> {
  const display = current.length ? current.join(", ") : "";
  const raw = await ask(
    rl,
    "allowFrom (comma-separated, * for all)",
    display || "*",
  );
  return parseAllowFrom(raw, current);
}

async function configureWebchat(
  rl: ReturnType<typeof createPrompt>,
  existing?: ChannelAccount,
): Promise<ChannelAccount> {
  console.log("\n--- WebChat (local REPL, no credentials) ---");
  const enabled = await askYesNo(rl, "Enable this account?", existing?.enabled !== false);
  return { enabled, dmPolicy: "open", allowFrom: ["*"] };
}

async function configureFeishu(
  rl: ReturnType<typeof createPrompt>,
  config: M3Config,
  existing?: ChannelAccount,
): Promise<ChannelAccount> {
  console.log("\n--- Feishu / Lark ---");
  console.log("Tip: run  m3 channels scan  for QR setup (App ID/Secret only).");
  console.log("Default: long connection — no Verification Token or ngrok.\n");

  const connectionMode = await askChoice(
    rl,
    "Connection mode",
    [
      { value: "long" as const, label: "long — WebSocket (recommended)" },
      { value: "webhook" as const, label: "webhook — HTTP callback (public URL)" },
    ],
    existing?.connectionMode ?? "long",
  );

  const enabled = await askYesNo(rl, "Enable this account?", existing?.enabled !== false);
  const appId = await ask(rl, "App ID", existing?.appId ?? "");
  const appSecret = await ask(
    rl,
    `App Secret${existing?.appSecret ? ` (current ${maskSecret(existing.appSecret)})` : ""}`,
    existing?.appSecret ?? "",
  );
  let verificationToken: string | undefined;
  let encryptKey: string | undefined;
  let webhookPath: string | undefined;
  let webhookPort: number | undefined;
  if (connectionMode === "webhook") {
    verificationToken = await ask(
      rl,
      "Verification Token (event subscription)",
      existing?.verificationToken ?? "",
    );
    encryptKey = await ask(
      rl,
      "Encrypt Key (optional, Enter to skip)",
      existing?.encryptKey ?? "",
    );
    webhookPath = await ask(rl, "Webhook path", existing?.webhookPath ?? "/feishu/events");
    const defaultPort = existing?.webhookPort ?? config.gateway.port + 1;
    webhookPort = await askNumber(rl, "Webhook port", defaultPort);
  }

  const dmPolicy = await askChoice(
    rl,
    "DM policy (dmPolicy)",
    [
      { value: "pairing" as const, label: "pairing — require /pair code (recommended)" },
      { value: "open" as const, label: "open — anyone can message" },
      { value: "closed" as const, label: "closed — reject DMs" },
    ],
    existing?.dmPolicy ?? "pairing",
  );
  const allowFrom = await promptAllowFrom(rl, existing?.allowFrom ?? []);

  const account: ChannelAccount = {
    enabled,
    connectionMode,
    appId: appId || undefined,
    appSecret: appSecret || undefined,
    dmPolicy,
    allowFrom,
  };
  if (verificationToken) account.verificationToken = verificationToken;
  if (encryptKey) account.encryptKey = encryptKey;
  if (webhookPath) account.webhookPath = webhookPath;
  if (webhookPort) account.webhookPort = webhookPort;

  if (connectionMode === "webhook" && webhookPath && webhookPort) {
    const base = `http://127.0.0.1:${webhookPort}${webhookPath.startsWith("/") ? webhookPath : `/${webhookPath}`}`;
    console.log(`\nFeishu event subscription URL: ${base}`);
  } else {
    console.log("\nAfter save, run m3 gateway and enable long connection in Feishu Open Platform.");
  }
  return account;
}

async function configureSlack(
  rl: ReturnType<typeof createPrompt>,
  existing?: ChannelAccount,
): Promise<ChannelAccount> {
  console.log("\n--- Slack (Socket Mode) ---");
  console.log("Enable Socket Mode at api.slack.com and create an App-Level Token (xapp-).\n");

  const enabled = await askYesNo(rl, "Enable this account?", existing?.enabled !== false);
  const botToken = await ask(
    rl,
    `Bot Token (xoxb-)${existing?.botToken ? ` current ${maskSecret(existing.botToken)}` : ""}`,
    existing?.botToken ?? "",
  );
  const appToken = await ask(
    rl,
    `App Token (xapp-)${existing?.appToken ? ` current ${maskSecret(existing.appToken)}` : ""}`,
    existing?.appToken ?? "",
  );
  const signingSecret = await ask(
    rl,
    "Signing Secret (optional)",
    existing?.signingSecret ?? "",
  );

  const dmPolicy = await askChoice(
    rl,
    "DM policy (dmPolicy)",
    [
      { value: "pairing" as const, label: "pairing" },
      { value: "open" as const, label: "open" },
      { value: "closed" as const, label: "closed" },
    ],
    existing?.dmPolicy ?? "pairing",
  );
  const allowFrom = await promptAllowFrom(rl, existing?.allowFrom ?? []);

  const account: ChannelAccount = {
    enabled,
    botToken: botToken || undefined,
    appToken: appToken || undefined,
    dmPolicy,
    allowFrom,
  };
  if (signingSecret) account.signingSecret = signingSecret;
  return account;
}

function printAccountSummary(kind: ChannelKind, accountId: string, acc: ChannelAccount): void {
  console.log(`\nPreview [${kind}/${accountId}]`);
  console.log(`  enabled: ${acc.enabled !== false}`);
  if (kind === "feishu") {
    console.log(`  appId: ${acc.appId ?? "(empty)"}`);
    console.log(`  appSecret: ${maskSecret(acc.appSecret)}`);
    console.log(`  webhook: :${acc.webhookPort ?? "?"}${acc.webhookPath ?? ""}`);
    console.log(`  verificationToken: ${acc.verificationToken ? "set" : "(empty)"}`);
  }
  if (kind === "slack") {
    console.log(`  botToken: ${maskSecret(acc.botToken)}`);
    console.log(`  appToken: ${maskSecret(acc.appToken)}`);
  }
  console.log(`  dmPolicy: ${acc.dmPolicy ?? "pairing"}`);
  console.log(`  allowFrom: ${(acc.allowFrom ?? []).join(", ") || "(empty)"}`);
}

export function listChannels(config: M3Config): void {
  const rows: Array<{ channel: string; account: string; enabled: string; status: string }> = [];
  for (const [ch, label] of [
    ["webchat", "WebChat"],
    ["feishu", "Feishu"],
    ["slack", "Slack"],
  ] as const) {
    const accounts = config.channels[ch];
    if (!accounts || Object.keys(accounts).length === 0) {
      rows.push({ channel: label, account: "-", enabled: "-", status: "not configured" });
      continue;
    }
    for (const [accountId, acc] of Object.entries(accounts)) {
      const enabled = acc.enabled !== false ? "yes" : "no";
      const ok =
        ch === "feishu"
          ? Boolean(acc.appId && acc.appSecret)
          : ch === "slack"
            ? Boolean(acc.botToken && acc.appToken)
            : true;
      rows.push({
        channel: label,
        account: accountId,
        enabled,
        status: ok ? "ready" : "incomplete",
      });
    }
  }
  console.log("\nCurrent channels:\n");
  console.log("Channel\t\tAccount\t\tEnabled\tStatus");
  for (const r of rows) {
    console.log(`${r.channel}\t\t${r.account}\t\t${r.enabled}\t${r.status}`);
  }
}

export async function runChannelsWizard(configPath?: string): Promise<void> {
  const resolved = resolveConfigPath(configPath);
  const config = loadConfig(configPath);
  const rl = createPrompt();

  console.log("m3 channel configuration wizard");
  console.log(`Config: ${resolved} (${configExists(configPath) ? "exists" : "will create"})`);
  console.log("Feishu users: prefer  m3 channels scan\n");

  listChannels(config);

  const channel = await askChoice<ChannelKind>(
    rl,
    "Which channel to configure?",
    [
      { value: "webchat", label: "WebChat — local terminal test" },
      { value: "feishu", label: "Feishu / Lark bot" },
      { value: "slack", label: "Slack — Socket Mode" },
    ],
    "webchat",
  );

  const accountId = await ask(rl, "Account ID (use different ids for multiple bots)", "default");
  const existing = config.channels[channel]?.[accountId] as ChannelAccount | undefined;

  let account: ChannelAccount;
  if (channel === "webchat") {
    account = await configureWebchat(rl, existing);
  } else if (channel === "feishu") {
    account = await configureFeishu(rl, config, existing);
  } else {
    account = await configureSlack(rl, existing);
  }

  printAccountSummary(channel, accountId, account);

  const save = await askYesNo(rl, `\nSave to ${resolved}?`, true);
  closePrompt(rl);

  if (!save) {
    console.log("Cancelled. Not saved.");
    return;
  }

  if (!config.channels[channel]) {
    config.channels[channel] = {};
  }
  const merged: ChannelAccount = {
    ...account,
    enabled: account.enabled !== false,
    connectionMode: account.connectionMode ?? (channel === "feishu" ? "long" : undefined),
    dmPolicy: account.dmPolicy ?? "pairing",
    allowFrom: account.allowFrom ?? [],
  };
  (config.channels[channel] as Record<string, ChannelAccount>)[accountId] = merged;
  saveConfig(config, configPath);

  console.log(`\nSaved to ${resolved}`);
  console.log("Next steps:");
  if (channel === "webchat") {
    console.log("  m3 webchat");
  } else {
    console.log("  m3 gateway   # or: m3 chat");
    console.log("  See docs/CHANNELS.md");
  }
}
