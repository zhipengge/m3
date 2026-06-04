#!/usr/bin/env node
import { Command } from "commander";
import { createAgentEngine } from "@m3/agent";
import { registerWebChatClient, simulateWebChatInbound } from "@m3/channel-extensions";
import {
  configExists,
  expandHome,
  loadConfig,
  loadSecrets,
  resolveAgentWorkspace,
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
import { runInteractiveRepl } from "./interactive-repl.js";
import { runFeishuScanSetup } from "./scan-setup.js";
import { registerLocalCommand } from "./local-command.js";
import { registerModelCommands } from "./model-command.js";
import { registerTerminalPermissionPrompt } from "./terminal-permission.js";
import { registerConfigCommand } from "./config-command.js";
import { registerInitCommand } from "./init-command.js";
import { promptWorkspaceAccess } from "./workspace-grant.js";
import { getLocalStatus, prepareInferenceBackend } from "@m3/local";
import { header, status, suggest, c } from "./output.js";

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
  plainRepl?: boolean;
}): Promise<void> {
    let config = loadConfig(opts.config);
    if (opts.port) {
      config.gateway.port = Number(opts.port);
    }
    const launchCwd = process.cwd();
    if (!config.agent.cwd?.trim()) {
      config = { ...config, agent: { ...config.agent, cwd: launchCwd } };
    }
    if (!opts.mock) {
      await prepareInferenceBackend(config);
    }
    const { bind, port } = config.gateway;

    if (isPortInUse(port, bind)) {
      console.error(`${c.err(c.bold("✗ Port in use"))}: ${bind}:${port}`);
      console.error(`  ${c.muted("Another process is already bound to this address.")}`);
      suggest(`Stop it with: ${c.brand("m3 gateway stop")}`);
      suggest(`Or pick another port: ${c.brand(`m3 gateway --port ${port + 1}`)}`);
      process.exit(1);
    }

    const server = await createGatewayServer({ config, mockAgent: opts.mock });

    let shuttingDown = false;
    let shutdownTask: Promise<void> | null = null;
    const shutdown = (): Promise<void> => {
      if (shutdownTask) return shutdownTask;
      shuttingDown = true;
      shutdownTask = (async () => {
        console.log("\nShutting down gateway...");
        try {
          await server.stop();
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
        }
      })();
      return shutdownTask;
    };

    let sigintCount = 0;
    const onSignal = () => {
      sigintCount += 1;
      if (sigintCount >= 2 && shuttingDown) {
        console.log("\nForce exit.");
        process.exit(1);
      }
      void shutdown().then(() => process.exit(0));
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    try {
      let grantedWorkspace: string | undefined;
      if (opts.interactive) {
        const workspace = resolveAgentWorkspace(config.agent, launchCwd);
        const granted = await promptWorkspaceAccess(workspace);
        if (!granted) {
          console.error("Cannot run interactive m3 without workspace access.");
          process.exit(1);
        }
        grantedWorkspace = workspace;
      }

      const { url } = await server.start();
      console.log(`${c.brand(c.bold("m3"))} ${c.ok("ready")} ${c.muted("—")} ${c.accent(url)}`);
      console.log(`  ${c.muted("Dashboard:")} ${c.accent(`http://${bind}:${port}/dashboard`)}`);
      console.log(`  ${c.muted("Health:   ")} ${c.accent(`http://${bind}:${port}/health`)}`);
      if (opts.interactive && grantedWorkspace) {
        server.getPermissionBridge().grantWorkspace(grantedWorkspace);
        if (config.agent.permissionMode === "default") {
          registerTerminalPermissionPrompt(server.getPermissionBridge());
        }
        try {
          await runGatewayRepl(server, config, {
            plain: opts.plainRepl,
            workspace: grantedWorkspace,
          });
        } finally {
          await shutdown();
          process.exit(0);
        }
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${c.err(c.bold("✗ Startup failed"))}: ${msg}`);
      if (msg.toLowerCase().includes("api key") || msg.toLowerCase().includes("secrets")) {
        suggest(`Edit secrets: ${c.brand("$EDITOR ~/.m3/secrets.json")}`);
        suggest(`Then re-run: ${c.brand("m3 doctor")}`);
      } else if (msg.toLowerCase().includes("model")) {
        suggest(`List models: ${c.brand("m3 models")}`);
        suggest(`Switch model: ${c.brand("m3 model <ref>")}`);
      } else {
        suggest(`Check installation: ${c.brand("m3 doctor")}`);
      }
      process.exit(1);
    }

    await new Promise<void>(() => {});
}

program
  .command("gateway")
  .description("Start m3 gateway daemon")
  .option("--mock", "Use mock agent engine")
  .option("-i, --interactive", "Terminal REPL (Claude Code-style)")
  .option("--plain", "Plain readline REPL (no Ink UI)")
  .option("--port <port>", "Override gateway port")
  .option("--config <path>", "Config file path")
  .action(
    async (opts: {
      mock?: boolean;
      port?: string;
      config?: string;
      interactive?: boolean;
      plain?: boolean;
    }) => {
      await startGateway({ ...opts, plainRepl: opts.plain });
    },
  )
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
    let thinkingActive = false;
    try {
      for await (const evt of engine.run({
        prompt: text,
        permissionMode: "bypassPermissions",
      })) {
        if (evt.type === "reasoning_delta") {
          if (!thinkingActive) {
            process.stderr.write("\x1b[2m\x1b[3m∴ Thinking\x1b[0m\n");
            thinkingActive = true;
          }
          process.stderr.write(`\x1b[2m${evt.delta}\x1b[0m`);
        }
        if (evt.type === "assistant_delta") {
          if (thinkingActive) {
            process.stderr.write("\n\n");
            thinkingActive = false;
          }
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

    header("doctor", "environment & configuration check");
    const issues: string[] = [];

    status("info", "Config", `${path} ${configExists(opts.config) ? "(found)" : "(defaults)"}`);
    status(
      secretsExists() ? "ok" : "warn",
      "Secrets",
      secretsExists() ? "~/.m3/secrets.json" : "~/.m3/secrets.json missing",
    );
    if (!secretsExists()) {
      issues.push("secrets.json missing");
      suggest(`Run: ${c.brand("$EDITOR ~/.m3/secrets.json")}`);
    }

    status("info", "Gateway bind", `${config.gateway.bind}:${config.gateway.port}`);
    if (config.gateway.bind !== "127.0.0.1" && config.gateway.bind !== "localhost" && !config.gateway.authToken) {
      issues.push("gateway bound to non-loopback without authToken");
      status("err", "Gateway authToken", "not set on a non-loopback bind");
      suggest("Set gateway.authToken in m3.json before exposing the gateway.");
    } else {
      status(
        config.gateway.authToken ? "ok" : "warn",
        "Gateway authToken",
        config.gateway.authToken ? "set" : "not set (loopback only)",
      );
    }
    status(
      isPortInUse(config.gateway.port, config.gateway.bind) ? "warn" : "ok",
      "Gateway port",
      isPortInUse(config.gateway.port, config.gateway.bind) ? "in use" : "free",
    );
    if (isPortInUse(config.gateway.port, config.gateway.bind)) {
      suggest("Run: m3 gateway stop");
    }

    status("info", "Agent engine", config.agent.engine);
    status(
      config.agent.sandbox?.enabled !== false ? "ok" : "warn",
      "Sandbox",
      config.agent.sandbox?.enabled !== false ? "enabled" : "disabled",
    );
    status("info", "Default model", config.models.default);
    status("info", "Active model", config.agent.model);

    try {
      const resolved = resolveModel(config, secrets, config.agent.model);
      status("ok", "Model resolved", `${resolved.providerId} / ${resolved.modelId}`);
      if (!resolved.apiKey) {
        issues.push(`API key missing for provider ${resolved.providerId}`);
        status("err", "API key", "missing");
        suggest("Add the matching key to ~/.m3/secrets.json");
      } else {
        status("ok", "API key", `${resolved.apiKey.slice(0, 8)}…`);
      }
    } catch (err) {
      issues.push(`Model resolution failed: ${err instanceof Error ? err.message : String(err)}`);
      status("err", "Model resolved", err instanceof Error ? err.message : String(err));
    }

    const mcpPath = config.agent.mcp?.config;
    if (mcpPath) {
      const resolved = expandHome(mcpPath);
      const fromFile = loadMcpConfig(mcpPath);
      const merged = mergeMcpServers(fromFile, config.agent.mcp?.servers);
      const found = fs.existsSync(resolved);
      status(
        found ? "ok" : "warn",
        "MCP config",
        `${resolved} (${found ? "found" : "missing"}) — ${Object.keys(merged).length} server(s)`,
      );
      if (!found) {
        suggest("Check agent.mcp.config in m3.json, or remove the entry to disable MCP");
      }
    } else {
      status("info", "MCP config", "(not set)");
    }

    const skillDirs = config.agent.skills?.dirs ?? [];
    status("info", "Skill dirs", skillDirs.length ? skillDirs.join(", ") : "(none)");

    const plugins = await loadM3PluginsFromConfig(config);
    status(
      "info",
      "Plugins",
      `${plugins.pluginIds.length ? plugins.pluginIds.join(", ") : "(none)"} | tools: ${plugins.toolNames.join(", ") || "-"} | cmds: ${plugins.commandNames.join(", ") || "-"}`,
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
        status(
          ok ? "ok" : "warn",
          `${label} [${accountId}]`,
          `${on ? "enabled" : "disabled"}, ${ok ? "configured" : "incomplete"}, dmPolicy=${acc.dmPolicy}`,
        );
        if (!ok) suggest(`Finish configuring ${label} [${accountId}] in m3.json`);
      }
    }

    status("info", "Permission mode", config.agent.permissionMode);
    const chMode = config.agent.channelPermissionMode ?? "bypassPermissions";
    status("info", "Channel permission mode", chMode);
    status("info", "Slash commands", String(listCommands().length));

    try {
      const local = await getLocalStatus();
      if (local.state) {
        status(
          local.modelReady && local.healthOk ? "ok" : "warn",
          "Local model",
          `${local.modelReady ? "weights ready" : "weights incomplete"}, server ${local.healthOk ? "running" : "stopped"}`,
        );
        if (local.state && !local.healthOk && config.agent.model.startsWith("local/")) {
          suggest("Run: m3 local start");
        }
      } else if (config.agent.model.startsWith("local/") || config.models.default.startsWith("local/")) {
        status("warn", "Local model", "not set up");
        suggest("Run: m3 local");
      }
    } catch {
      /* ignore */
    }

    console.log();
    if (issues.length === 0) {
      status("ok", "Doctor", "all checks passed — see docs/CHANNELS.md for channel setup");
    } else {
      status("warn", "Doctor", `${issues.length} issue(s) need attention`);
      for (const i of issues) suggest(i);
    }
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
registerModelCommands(program);
registerConfigCommand(program);
registerInitCommand(program);

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
  .option("--plain", "Plain readline REPL (no Ink UI)")
  .option("--port <port>", "Override gateway port")
  .option("--config <path>", "Config file path")
  .action(async (opts: { mock?: boolean; port?: string; config?: string; plain?: boolean }) => {
    await startGateway({ ...opts, interactive: true, plainRepl: opts.plain });
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
  .description("Run ./install.sh (build, ~/.local/bin/m3, ~/.m3 config)")
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
  .option("--plain", "Plain readline REPL (no Ink UI)")
  .option("--peer <id>", "Peer id", "local-user")
  .option("--port <port>", "Override gateway port")
  .option("--config <path>", "Config file path")
  .action(async (opts: {
    mock?: boolean;
    plain?: boolean;
    peer?: string;
    port?: string;
    config?: string;
  }) => {
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
    const dashboardUrl = `http://${config.gateway.bind}:${config.gateway.port}/dashboard`;

    const rl = await runInteractiveRepl({
      plain: opts.plain,
      peerId: peer,
      config,
      dashboardUrl,
      prompt: "you> ",
      repromptAfterSubmit: false,
      showMenuOnStart: Boolean(opts.plain),
      onLine: async (line, media) => {
        const runtime = {
          config,
          log: () => {},
          onInbound: (msg: import("@m3/channels").InboundMessage) => server.dispatchInbound(msg),
        };
        await simulateWebChatInbound(runtime, peer, line.trim(), media);
      },
    });

    if (rl) {
      registerWebChatClient(peer, (text) => {
        console.log(`\n[assistant] ${text}\n`);
        rl.prompt();
      });
      rl.prompt();
    }

    let webchatShuttingDown = false;
    const stopWebchat = async () => {
      if (webchatShuttingDown) {
        process.exit(1);
      }
      webchatShuttingDown = true;
      console.log("\nShutting down gateway...");
      await server.stop();
      rl?.close();
      process.exit(0);
    };
    process.on("SIGINT", () => void stopWebchat());
    process.on("SIGTERM", () => void stopWebchat());
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
