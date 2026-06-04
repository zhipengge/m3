import readline from "node:readline";
import { completeSlashLine, formatSlashCommandMenu, listCommands } from "@m3/commands";

/**
 * Media attached to a single user turn. Image media is forwarded to the
 * engine as vision input; non-image media is appended to the prompt as
 * a path string for the LLM to Read. The Ink REPL populates this when
 * the user pastes a clipboard image (Ctrl+V); the readline path leaves
 * it undefined (paste is an Ink-only feature).
 */
export type ReplMedia = Array<{ type: "image" | "file"; path: string; mimeType?: string }>;

export type InteractiveReplOptions = {
  prompt?: string;
  onLine: (line: string, media?: ReplMedia) => void | Promise<void>;
  extraSlashCommands?: string[];
  showMenuOnStart?: boolean;
  repromptAfterSubmit?: boolean;
  /** Force plain readline (no Ink UI). */
  plain?: boolean;
  peerId?: string;
  config?: import("@m3/config").M3Config;
  workspace?: string;
  dashboardUrl?: string;
};

export type InteractiveRepl = readline.Interface;

function useInkRepl(opts: InteractiveReplOptions): boolean {
  if (opts.plain || process.env.M3_PLAIN_REPL === "1") return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function slashCompleter(extra: string[]) {
  return (line: string): [string[], string] => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("/")) return [[], line];
    const partial = trimmed.slice(1);
    const matches = completeSlashLine(trimmed, extra);
    if (partial.length === 0 && matches.length > 0) {
      process.stdout.write(`\n${formatSlashCommandMenu("", extra)}\n`);
    }
    return [matches, trimmed];
  };
}

/**
 * Run Claude Code–style terminal UI (Ink) or fall back to readline.
 */
export async function runInteractiveRepl(options: InteractiveReplOptions): Promise<InteractiveRepl | null> {
  if (useInkRepl(options) && options.peerId && options.config) {
    const { runInkRepl } = await import("./tui/run-ink-repl.js");
    await runInkRepl({
      peerId: options.peerId,
      config: options.config,
      workspace: options.workspace,
      dashboardUrl: options.dashboardUrl,
      onLine: options.onLine,
    });
    return null;
  }

  const extra = options.extraSlashCommands ?? [];
  const allSlash = [...new Set([...listCommands(), ...extra])];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: slashCompleter(allSlash),
  });

  const prompt = options.prompt ?? "\x1b[32myou\x1b[0m> ";
  rl.setPrompt(prompt);

  if (options.showMenuOnStart !== false) {
    process.stdout.write(`\n${formatSlashCommandMenu("", allSlash)}\n\n`);
    process.stdout.write(
      "\x1b[2mTip: type / then Tab · M3_INK_REPL=1 default in TTY · M3_PLAIN_REPL=1 for plain\x1b[0m\n\n",
    );
  }

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    const normalized = trimmed === "?" || trimmed === "？" ? "/help" : line;
    void Promise.resolve(options.onLine(normalized)).finally(() => {
      if (options.repromptAfterSubmit) rl.prompt();
    });
  });

  return rl;
}

/** @deprecated Use runInteractiveRepl */
export function createInteractiveRepl(options: InteractiveReplOptions): InteractiveRepl {
  const extra = options.extraSlashCommands ?? [];
  const allSlash = [...new Set([...listCommands(), ...extra])];
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: slashCompleter(allSlash),
  });
  rl.setPrompt(options.prompt ?? "\x1b[32myou\x1b[0m> ");
  if (options.showMenuOnStart !== false) {
    process.stdout.write(`\n${formatSlashCommandMenu("", allSlash)}\n\n`);
  }
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    const normalized = trimmed === "?" || trimmed === "？" ? "/help" : line;
    void Promise.resolve(options.onLine(normalized)).finally(() => {
      if (options.repromptAfterSubmit) rl.prompt();
    });
  });
  return rl;
}
