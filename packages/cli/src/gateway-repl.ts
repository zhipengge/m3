import type { GatewayServer } from "@m3/gateway";
import { simulateWebChatInbound } from "@m3/channel-extensions";
import type { M3Config } from "@m3/config";
import { runInteractiveRepl } from "./interactive-repl.js";

const TERMINAL_PEER = "terminal";

export type GatewayReplOptions = {
  plain?: boolean;
  workspace?: string;
};

export async function runGatewayRepl(
  server: GatewayServer,
  config: M3Config,
  opts: GatewayReplOptions = {},
): Promise<void> {
  const dashboardUrl = `http://${config.gateway.bind}:${config.gateway.port}/dashboard`;

  if (!opts.plain) {
    process.stdout.write("\x1b[2J\x1b[H");
  } else {
    console.log("\x1b[1mm3 interactive terminal\x1b[0m");
    console.log(`  Dashboard: ${dashboardUrl}`);
    console.log("  Exit: Ctrl+C\n");
  }

  const rl = await runInteractiveRepl({
    plain: opts.plain,
    peerId: TERMINAL_PEER,
    config,
    workspace: opts.workspace,
    dashboardUrl,
    repromptAfterSubmit: false,
    showMenuOnStart: opts.plain,
    onLine: async (line, media) => {
      const runtime = {
        config,
        log: (msg: string) => {
          if (opts.plain) console.log(`[m3] ${msg}`);
        },
        onInbound: (msg: import("@m3/channels").InboundMessage) => server.dispatchInbound(msg),
      };
      // Forward any clipboard-pasted media (Ctrl+V in the Ink REPL) so
      // the engine receives image attachments as vision input.
      await simulateWebChatInbound(runtime, TERMINAL_PEER, line.trim(), media);
    },
  });

  if (rl) {
    const { registerWebChatClient } = await import("@m3/channel-extensions");
    registerWebChatClient(TERMINAL_PEER, (text) => {
      process.stdout.write(`\n\x1b[36massistant\x1b[0m ${text}\n\n`);
      rl.prompt();
    });
    rl.prompt();
  }
}
