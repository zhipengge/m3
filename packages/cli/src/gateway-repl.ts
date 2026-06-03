import type { GatewayServer } from "@m3/gateway";
import { registerWebChatClient, simulateWebChatInbound } from "@m3/channel-extensions";
import type { M3Config } from "@m3/config";
import { listCommands } from "@m3/commands";

const TERMINAL_PEER = "terminal";

export async function runGatewayRepl(server: GatewayServer, config: M3Config): Promise<void> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  registerWebChatClient(TERMINAL_PEER, (text) => {
    process.stdout.write(`\n\x1b[36massistant\x1b[0m ${text}\n\n`);
    rl.prompt();
  });

  const slash = listCommands().slice(0, 12).map((c) => `/${c}`).join(" ");
  console.log("\n\x1b[1mm3 interactive terminal\x1b[0m (Claude Code–style)");
  console.log("  Type a message and press Enter. Slash commands: /help /clear /status");
  console.log(`  Examples: ${slash} …`);
  console.log(`  Dashboard: http://${config.gateway.bind}:${config.gateway.port}/dashboard`);
  console.log("  Exit: Ctrl+C\n");

  rl.setPrompt("\x1b[32myou\x1b[0m> ");
  rl.prompt();

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    void (async () => {
      const runtime = {
        config,
        log: (msg: string) => console.log(`[m3] ${msg}`),
        onInbound: (msg: import("@m3/channels").InboundMessage) => server.dispatchInbound(msg),
      };
      await simulateWebChatInbound(runtime, TERMINAL_PEER, trimmed);
    })();
  });
}
