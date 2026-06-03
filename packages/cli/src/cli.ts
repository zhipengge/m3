#!/usr/bin/env node
import { Command } from "commander";
import { createAgentEngine } from "@m3/agent";
import { registerWebChatClient, simulateWebChatInbound } from "@m3/channel-extensions";
import {
  configExists,
  expandHome,
  loadConfig,
  loadSecrets,
  resolveConfigPath,
  resolveModel,
  saveConfig,
  secretsExists,
} from "@m3/config";
import {
  createGatewayServer,
  findProcessOnPort,
  stopProcessOnPort,
  isPortInUse,
} from "@m3/gateway";
import { readGatewayPid } from "@m3/gateway";
import { listCommands } from "@m3/commands";
import { loadM3PluginsFromConfig } from "@m3/plugin-sdk";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMcpConfig, mergeMcpServers } from "@m3/agent";
import { listChannels, runChannelsWizard } from "./channels-wizard.js";
import { installCompletion, printCompletion } from "./completion.js";
import { runGatewayRepl } from "./gateway-repl.js";
import { createInteractiveRepl } from "./interactive-repl.js";
import { runFeishuScanSetup } from "./scan-setup.js";
import { registerLocalCommand } from "./local-command.js";
import { getLocalStatus, prepareInferenceBackend } from "@m3/local";

const program = new Command();

program.name("m3").description("m3 — multi-modality, multi-task, multi-agent framework").version("0.2.0");

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

program
  .command("build")
  .description("Build all m3 packages (pnpm -r build at monorepo root)")
  .action(() => {
    const root = findRepoRoot();
    console.log(`Building m3 at ${root}…`);
    execSync("pnpm -r --sort run build", { cwd: root, stdio: "inherit" });
  });

async function startGateway(opts: {
  mock?: boolean;
  port?: string;
  config?: string;
  interactive?: boolean;
}): Promise<void> {
    const config = loadConfig(opts.config);
    if (opts.port) {
      config.gateway.port = Number(opts.port);
    }
    if (!opts.mock) {
      await prepareInferenceBackend(config);
    }
    const { bind, port } = config.gateway;

    if (isPortInUse(port, bind)) {
      console.error(`Error: port ${bind}:${port} is already in use.`);
      console.error(`Run: m3 gateway stop`);
      process.exit(1);
    }

    const server = await createGatewayServer({ config, mockAgent: opts.mock });
    try {
      const { url } = await server.start();
      console.log(`m3 gateway listening on ${url}`);
      console.log(`Dashboard: http://${bind}:${port}/dashboard`);
      console.log(`Health: http://${bind}:${port}/health`);
      if (opts.interactive) {
        await runGatewayRepl(server, config);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const shutdown = async () => {
      console.log("\nShutting down gateway...");
      await server.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

program
  .command("gateway")
  .description("Start m3 gateway daemon")
  .option("--mock", "Use mock agent engine")
  .option("-i, --interactive", "Terminal REPL (Claude Code-style)")
  .option("--port <port>", "Override gateway port")
  .option("--config <path>", "Config file path")
  .action(async (opts: { mock?: boolean; port?: string; config?: string; interactive?: boolean }) => {
    await startGateway(opts);
  })
  .command("stop")
  .description("Stop gateway listening on configured port")
  .option("--config <path>", "Config file path")
  .action((opts: { config?: string }) => {
    const config = loadConfig(opts.config);
    const { bind, port } = config.gateway;
    const stopped = stopProcessOnPort(port, bind);
    if (!stopped) {
      console.log(`No process listening on ${bind}:${port}`);
      return;
    }
    console.log(`Stopped ${stopped.command} (pid ${stopped.pid}) on ${bind}:${port}`);
  });

program
  .command("agent")
  .description("Run agent in headless mode")
  .argument("[prompt]", "Prompt text")
  .option("-p, --print", "Print mode (required for headless)")
  .option("--mock", "Use mock agent")
  .option("--model <ref>", "Model ref override e.g. deepseek/deepseek-chat")
  .option("--config <path>", "Config file path")
  .action(async (prompt: string | undefined, opts: { print?: boolean; mock?: boolean; model?: string; config?: string }) => {
    if (!opts.print && !prompt) {
      console.error("Use -p/--print for headless mode, e.g. m3 agent -p \"hello\"");
      process.exit(1);
    }
    const config = loadConfig(opts.config);
    if (!opts.mock) {
      await prepareInferenceBackend(config);
    }
    await loadM3PluginsFromConfig(config);
    const agentConfig = opts.model ? { ...config.agent, model: opts.model } : config.agent;
    const engine = createAgentEngine({ config: agentConfig, m3Config: config, mock: opts.mock });
    const text = prompt ?? "";
    let printed = false;
    try {
      for await (const evt of engine.run({
        prompt: text,
        permissionMode: "bypassPermissions",
      })) {
        if (evt.type === "assistant_delta") {
          process.stdout.write(evt.delta);
          printed = true;
        }
        if (evt.type === "result" && evt.text) {
          if (!printed) process.stdout.write(evt.text);
          process.stdout.write("\n");
        }
        if (evt.type === "lifecycle" && evt.phase === "error") {
          console.error(`\nError: ${evt.error ?? "unknown"}`);
          process.exit(1);
        }
      }
    } finally {
      if (!opts.mock) {
        const { resetMcpPool } = await import("@m3/agent");
        await resetMcpPool();
      }
    }
  });

program
  .command("doctor")
  .description("Check m3 installation and configuration")
  .option("--config <path>", "Config file path")
  .action(async (opts: { config?: string }) => {
    const path = resolveConfigPath(opts.config);
    const config = loadConfig(opts.config);
    const secrets = loadSecrets();

    console.log("m3 doctor\n");
    console.log(`Config: ${path} (${configExists(opts.config) ? "found" : "defaults"})`);
    console.log(`Secrets: ~/.m3/secrets.json (${secretsExists() ? "found" : "missing"})`);
    console.log(`Gateway: ${config.gateway.bind}:${config.gateway.port}`);
    console.log(`Gateway authToken: ${config.gateway.authToken ? "set" : "not set"}`);
    console.log(`Gateway port: ${isPortInUse(config.gateway.port, config.gateway.bind) ? "IN USE" : "free"}`);
    console.log(`Agent engine: ${config.agent.engine}`);
    console.log(`Sandbox: ${config.agent.sandbox?.enabled !== false ? "enabled" : "disabled"}`);
    console.log(`Default model ref: ${config.models.default}`);
    console.log(`Active model ref: ${config.agent.model}`);

    try {
      const resolved = resolveModel(config, secrets, config.agent.model);
      console.log(`Resolved provider: ${resolved.providerId} (${resolved.api})`);
      console.log(`Resolved model: ${resolved.modelId}`);
      console.log(`API key: ${resolved.apiKey ? `${resolved.apiKey.slice(0, 8)}...` : "missing"}`);
    } catch (err) {
      console.log(`Model resolution: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }

    const mcpPath = config.agent.mcp?.config;
    if (mcpPath) {
      const resolved = expandHome(mcpPath);
      const fromFile = loadMcpConfig(mcpPath);
      const merged = mergeMcpServers(fromFile, config.agent.mcp?.servers);
      console.log(
        `MCP config: ${resolved} (${fs.existsSync(resolved) ? "found" : "missing"}) — ${Object.keys(merged).length} server(s)`,
      );
    } else {
      console.log("MCP config: (not set)");
    }

    const skillDirs = config.agent.skills?.dirs ?? [];
    console.log(`Skill dirs: ${skillDirs.length ? skillDirs.join(", ") : "(none)"}`);

    const plugins = await loadM3PluginsFromConfig(config);
    console.log(
      `Plugins: ${plugins.pluginIds.length ? plugins.pluginIds.join(", ") : "(none)"} | tools: ${plugins.toolNames.join(", ") || "-"} | cmds: ${plugins.commandNames.join(", ") || "-"}`,
    );

    for (const [ch, label] of [
      ["feishu", "Feishu"],
      ["slack", "Slack"],
      ["webchat", "WebChat"],
    ] as const) {
      const accounts = config.channels[ch];
      if (!accounts) continue;
      for (const [accountId, acc] of Object.entries(accounts)) {
        const on = acc.enabled !== false;
        const ok =
          ch === "feishu"
            ? Boolean(acc.appId && acc.appSecret)
            : ch === "slack"
              ? Boolean(acc.botToken && acc.appToken)
              : true;
        console.log(
          `${label} [${accountId}]: ${on ? "enabled" : "disabled"}, ${ok ? "configured" : "incomplete"}, dmPolicy=${acc.dmPolicy}`,
        );
      }
    }

    console.log(`Permission mode: ${config.agent.permissionMode}`);
    const chMode = config.agent.channelPermissionMode ?? "bypassPermissions";
    console.log(`Channel permission mode: ${chMode} (Feishu/Slack/WebChat inbound)`);
    console.log(`Slash commands: ${listCommands().length}`);

    try {
      const local = await getLocalStatus();
      if (local.state) {
        console.log(`\nLocal model: ${local.modelReady ? "weights ready" : "weights incomplete"}, server ${local.healthOk ? "running" : "stopped"}`);
        if (local.state && !local.healthOk && config.agent.model.startsWith("local/")) {
          console.log("  Run: m3 local start");
        }
      } else if (config.agent.model.startsWith("local/") || config.models.default.startsWith("local/")) {
        console.log("\nLocal model: not set up — run: m3 local");
      }
    } catch {
      /* ignore */
    }

    console.log("\nDoctor: OK — see docs/CHANNELS.md for channel setup");
  });

program
  .command("status")
  .description("Show gateway / install status")
  .option("--config <path>", "Config file path")
  .action((opts: { config?: string }) => {
    const config = loadConfig(opts.config);
    const { bind, port } = config.gateway;
    const usage = findProcessOnPort(port, bind);
    const pidInfo = readGatewayPid();
    console.log("m3 status\n");
    console.log(`Gateway target: ${bind}:${port}`);
    console.log(`Port in use: ${usage ? "yes" : "no"}`);
    if (usage) {
      console.log(`  process: ${usage.command} (pid ${usage.pid})`);
    }
    if (pidInfo) {
      console.log(`PID file: ~/.m3/gateway.pid → pid ${pidInfo.pid} (started ${pidInfo.startedAt})`);
    }
    console.log(`Dashboard: http://${bind}:${port}/dashboard`);
    console.log(`Config: ${resolveConfigPath(opts.config)}`);
  });

const channels = program.command("channels").description("Channel configuration");

channels
  .command("remove")
  .description("Remove a channel account from config")
  .requiredOption("--channel <id>", "feishu | slack | webchat")
  .option("--account <id>", "Account id", "default")
  .option("--config <path>", "Config file path")
  .action((opts: { channel: string; account?: string; config?: string }) => {
    const config = loadConfig(opts.config);
    const ch = opts.channel as keyof typeof config.channels;
    const accounts = config.channels[ch];
    if (!accounts || typeof accounts !== "object") {
      console.error(`Channel not configured: ${opts.channel}`);
      process.exit(1);
    }
    const accountId = opts.account ?? "default";
    if (!(accountId in accounts)) {
      console.error(`Account not found: ${accountId}`);
      process.exit(1);
    }
    delete (accounts as Record<string, unknown>)[accountId];
    saveConfig(config, opts.config);
    console.log(`Removed ${opts.channel}/${accountId} from ${resolveConfigPath(opts.config)}`);
  });

channels
  .command("configure", { isDefault: true })
  .description("Interactive wizard for WebChat / Feishu / Slack")
  .alias("setup")
  .option("--config <path>", "Config file path")
  .action(async (opts: { config?: string }) => {
    await runChannelsWizard(opts.config);
  });

channels
  .command("list")
  .description("List configured channel accounts")
  .option("--config <path>", "Config file path")
  .action((opts: { config?: string }) => {
    const config = loadConfig(opts.config);
    console.log(`Config: ${resolveConfigPath(opts.config)}`);
    listChannels(config);
  });

registerLocalCommand(program);

channels
  .command("scan")
  .description("QR setup for channels (Feishu; WeChat placeholder)")
  .option("--port <port>", "Setup server port", "18792")
  .option("--config <path>", "Config file path")
  .action(async (opts: { port?: string; config?: string }) => {
    const result = await runFeishuScanSetup({
      port: opts.port ? Number(opts.port) : 18792,
      configPath: opts.config,
    });
    if (result.saved) {
      console.log("\nConfig saved. Next: m3 chat");
    } else {
      console.log("\nNo save detected (form may not have been submitted).");
    }
  });

program
  .command("chat")
  .description("Start gateway with terminal REPL (recommended)")
  .option("--mock", "Use mock agent")
  .option("--port <port>", "Override gateway port")
  .option("--config <path>", "Config file path")
  .action(async (opts: { mock?: boolean; port?: string; config?: string }) => {
    await startGateway({ ...opts, interactive: true });
  });

const completionCmd = program
  .command("completion")
  .description("Shell tab completion (zsh / bash)")
  .argument("[shell]", "zsh | bash | install", "install")
  .action((shell: string) => {
    if (shell === "install") {
      const detected = process.env.SHELL?.includes("zsh") ? "zsh" : "bash";
      const result = installCompletion(detected);
      console.log(result.message);
      if (!result.ok) process.exit(1);
      return;
    }
    if (shell !== "zsh" && shell !== "bash") {
      console.error("Usage: m3 completion [install|zsh|bash]");
      process.exit(1);
    }
    printCompletion(shell);
  });

completionCmd.addHelpText(
  "after",
  "\nInstall tab completion:\n  m3 completion install\n  exec zsh   # or: source ~/.zshrc\n",
);

program
  .command("install")
  .description("Run install.sh (macOS, adds m3 to ~/.local/bin)")
  .action(() => {
    const root = findRepoRoot();
    const script = path.join(root, "install.sh");
    if (!fs.existsSync(script)) {
      console.error("install.sh not found in repo root");
      process.exit(1);
    }
    execSync(`bash "${script}"`, { cwd: root, stdio: "inherit" });
  });

program
  .command("webchat")
  .description("Interactive webchat REPL (local test)")
  .option("--mock", "Use mock agent")
  .option("--peer <id>", "Peer id", "local-user")
  .option("--port <port>", "Override gateway port")
  .option("--config <path>", "Config file path")
  .action(async (opts: { mock?: boolean; peer?: string; port?: string; config?: string }) => {
    const config = loadConfig(opts.config);
    if (opts.port) config.gateway.port = Number(opts.port);

    if (isPortInUse(config.gateway.port, config.gateway.bind)) {
      console.error(`Port ${config.gateway.bind}:${config.gateway.port} in use. Run: m3 gateway stop`);
      process.exit(1);
    }

    if (!opts.mock) {
      await prepareInferenceBackend(config);
    }

    const server = await createGatewayServer({ config, mockAgent: opts.mock });
    await server.start();
    console.log(`Gateway: http://${config.gateway.bind}:${config.gateway.port}/health`);

    const peer = opts.peer ?? "local-user";
    console.log(`WebChat REPL (peer=${peer}).`);

    const rl = createInteractiveRepl({
      prompt: "you> ",
      repromptAfterSubmit: false,
      onLine: async (line) => {
        const runtime = {
          config,
          log: () => {},
          onInbound: (msg: import("@m3/channels").InboundMessage) => server.dispatchInbound(msg),
        };
        await simulateWebChatInbound(runtime, peer, line.trim());
      },
    });

    registerWebChatClient(peer, (text) => {
      console.log(`\n[assistant] ${text}\n`);
      rl.prompt();
    });
    rl.prompt();

    process.on("SIGINT", async () => {
      await server.stop();
      rl.close();
      process.exit(0);
    });
  });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // No subcommand → Claude Code-style interactive session
  if (args.length === 0) {
    await startGateway({ interactive: true });
    return;
  }
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
