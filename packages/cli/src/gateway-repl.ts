import type { GatewayServer } from "@m3/gateway";
import { registerWebChatClient, simulateWebChatInbound } from "@m3/channel-extensions";
import type { M3Config } from "@m3/config";
import { createInteractiveRepl } from "./interactive-repl.js";

const TERMINAL_PEER = "terminal";

export async function runGatewayRepl(server: GatewayServer, config: M3Config): Promise<void> {
  console.log("\x1b[1mm3 interactive terminal\x1b[0m (Claude Code–style)");
  console.log(`  Dashboard: http://${config.gateway.bind}:${config.gateway.port}/dashboard`);
  console.log("  Exit: Ctrl+C\n");

  const rl = createInteractiveRepl({
    repromptAfterSubmit: false,
    onLine: async (line) => {
      const runtime = {
        config,
        log: (msg: string) => console.log(`[m3] ${msg}`),
        onInbound: (msg: import("@m3/channels").InboundMessage) => server.dispatchInbound(msg),
      };
      await simulateWebChatInbound(runtime, TERMINAL_PEER, line.trim());
    },
  });

  registerWebChatClient(TERMINAL_PEER, (text) => {
    process.stdout.write(`\n\x1b[36massistant\x1b[0m ${text}\n\n`);
    rl.prompt();
  });

  rl.prompt();
}
