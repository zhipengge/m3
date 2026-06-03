# m3 Development Guide

## Monorepo Layout

```
packages/
  config/           — m3.json schema + loader
  gateway-protocol/ — WS protocol types
  channels/         — ChannelPlugin contract, routing, turn kernel
  channel-extensions/ — webchat, slack, feishu + phase3 stubs
  agent/            — Claude Code engine + mock + phase2/4 modules
  bridge/           — SessionMapper, StreamAdapter, CommandBridge, PermissionBridge, Pipeline
  commands/         — Slash command registry (CC-compatible)
  gateway/          — GatewayServer + ChannelManager
  plugin-sdk/       — Plugin API for extensions
  cli/              — m3 CLI entry
apps/
  gateway-daemon/   — Daemon wrapper
```

## Build

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Local E2E (mock agent)

```bash
M3_MOCK_AGENT=1 pnpm --filter @m3/cli dev webchat --mock
```

## Real Claude Code

Requires `claude` authenticated on host:

```bash
claude auth login
m3 agent -p "list files in current directory"
m3 gateway start
```

## Plugins

```typescript
import { definePlugin, registerM3Plugin } from "@m3/plugin-sdk";

registerM3Plugin(definePlugin({
  id: "my-plugin",
  register(api) {
    api.registerTool({ name: "MyTool", ... });
    api.registerCommand("my-cmd", () => ({ action: "reply_only", text: "ok" }));
  },
}));
```

Gateway / `m3 agent` 启动前会调用 `loadM3PluginsFromConfig(config)`（内置 `hello` 插件，可通过 `plugins.entries.hello.enabled=false` 关闭）。外部 ESM 插件见 `examples/plugins/hello-plugin.mjs` 与 `plugins.paths`。

## Phase Roadmap

- **Phase 1 (MVP)**: Gateway + 3 channels + native engine + bridge + CLI — implemented
- **Phase 2**: MCP client, skills, plugins, sub-agents — largely implemented in `@m3/agent` + `@m3/plugin-sdk`
- **Phase 3**: 20+ channel stubs, pairing, thread bindings — stubs in `@m3/bridge` + `@m3/channel-extensions`
- **Phase 4**: TUI, IDE, Remote, Chrome, Voice, Control UI — interfaces in `@m3/agent/phase4-advanced`

## Forking from OpenClaw

Channel plugin contract follows OpenClaw `ChannelPlugin` shape (simplified). To port a channel:

1. Copy adapter from `openclaw/extensions/<channel>/`
2. Implement `ChannelPlugin` in `packages/channel-extensions/src/`
3. Register in `registerBundledChannels()`

## Claude Code Integration

m3 使用 **自研 native harness**（`packages/agent`），直接调用 `@anthropic-ai/sdk`，架构模式迁移自 Claude Code 的 query loop / Tool / toolOrchestration。

- 默认引擎：`agent.engine = "native"`
- 遗留 CLI：`agent.engine = "legacy-cli"`（不推荐）
- 离线开发：`M3_MOCK_AGENT=1`
