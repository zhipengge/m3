import readline from "node:readline";
import { completeSlashLine, formatSlashCommandMenu, listCommands } from "@m3/commands";

export type InteractiveReplOptions = {
  prompt?: string;
  /** Called for each submitted line (after ? → /help normalization). */
  onLine: (line: string) => void | Promise<void>;
  /** Extra slash names from plugins (merged into completion). */
  extraSlashCommands?: string[];
  /** Print full command menu on startup. Default true. */
  showMenuOnStart?: boolean;
  /** Re-show prompt right after submit. Default false (e.g. wait for assistant reply). */
  repromptAfterSubmit?: boolean;
};

export type InteractiveRepl = readline.Interface;

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

function normalizeReplLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed === "?" || trimmed === "？") return "/help";
  return line;
}

/**
 * Claude Code / OpenClaw–style REPL: slash command Tab completion + command menu.
 */
export function createInteractiveRepl(options: InteractiveReplOptions): InteractiveRepl {
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
      "\x1b[2mTip: type / then Tab to complete · Tab twice to list · ? for help\x1b[0m\n\n",
    );
  }

  rl.on("line", (line) => {
    const normalized = normalizeReplLine(line);
    const trimmed = normalized.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    void Promise.resolve(options.onLine(normalized)).finally(() => {
      if (options.repromptAfterSubmit) rl.prompt();
    });
  });

  return rl;
}

export function printReplSlashHint(): void {
  process.stdout.write(
    "\x1b[2mSlash commands: type / then Tab · menu on startup · ? = /help\x1b[0m\n",
  );
}
