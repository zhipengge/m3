/** Phase 4 advanced feature interfaces — TUI, IDE, Remote, Chrome, Voice. */

export type TuiReplOptions = {
  cwd?: string;
  model?: string;
  claudeCommand?: string;
};

export function launchTuiRepl(options: TuiReplOptions): never {
  throw new Error(
    `TUI REPL delegates to Claude Code interactive mode. Run: ${options.claudeCommand ?? "claude"} (cwd=${options.cwd ?? process.cwd()})`,
  );
}

export type IdeBridgeOptions = {
  mode: "vscode" | "jetbrains" | "mcp-serve";
  port?: number;
};

export function startIdeBridge(options: IdeBridgeOptions): { url: string } {
  const port = options.port ?? 18791;
  return { url: `mcp://127.0.0.1:${port}/${options.mode}` };
}

export type RemoteControlOptions = {
  mode: "ssh" | "bridge";
  target?: string;
};

export function startRemoteControl(options: RemoteControlOptions): { endpoint: string } {
  return { endpoint: `${options.mode}://${options.target ?? "localhost"}` };
}

export type ChromeIntegrationOptions = {
  enabled: boolean;
  mcpServer?: string;
};

export function configureChromeUse(options: ChromeIntegrationOptions): ChromeIntegrationOptions {
  return options;
}

export type VoiceModeOptions = {
  provider: "system" | "elevenlabs";
  wakeWord?: string;
};

export function configureVoiceMode(options: VoiceModeOptions): VoiceModeOptions {
  return options;
}

export type ControlUiOptions = {
  port: number;
  bind: string;
};

export function controlUiUrl(options: ControlUiOptions): string {
  return `http://${options.bind}:${options.port}/`;
}
