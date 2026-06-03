# m3 Agent Coder

**m3** = **multi-Agent** · **multi-Modal** · **multi-Task**

m3 combines **OpenClaw-style multi-channel access** with an **in-process Agent harness** migrated from Claude Code patterns. No CLI subprocess wrapper, no duplicate wheels—one stack for channels, tools, skills, MCP, and plugins.

| Pillar | What it means |
|--------|----------------|
| **multi-Agent** | Route inbound messages to agents via `sessionKey`; sub-agents via `agent.subAgents` |
| **multi-Modal** | `InboundMessage.media` for images/files; channels download attachments to disk |
| **multi-Task** | Many channels × accounts × sessions in parallel, each with its own transcript |

## Features

- **Channels**: WebChat, Slack (Socket Mode), Feishu/Lark (long connection or webhook)
- **Native harness**: In-process loop with DeepSeek (OpenAI-compatible) and Anthropic
- **Security**: Workspace sandbox, Bash env allowlist, permission modes, audit log
- **Ecosystem**: Skills (`SKILL.md`), MCP (`mcpServers`), plugins (`@m3/plugin-sdk`)
- **CLI**: `m3` interactive terminal (Claude Code–style), tab completion, web dashboard

## Quick start (macOS)

```bash
git clone git@github.com:zhipengge/m3.git
cd m3
./install.sh
export PATH="$HOME/.local/bin:$PATH"

cp examples/secrets.json.example ~/.m3/secrets.json   # add API keys
cp examples/m3.json ~/.m3/m3.json                     # optional

m3 completion install && exec zsh   # tab completion (once)
m3 doctor
m3 channels scan                  # QR setup for Feishu
m3                                # interactive terminal (same as m3 chat)

open http://127.0.0.1:18790/dashboard
```

**Development** (from repo root):

```bash
pnpm install && pnpm build && pnpm test
pnpm m3 doctor
```

> Tab completion only works for the global `m3` binary, not `pnpm m3`.

## Interactive terminal (like Claude Code)

```bash
m3              # default: gateway + REPL
m3 chat         # explicit
m3 gateway -i   # same
```

At the `you>` prompt, type natural language or slash commands (`/help`, `/clear`, `/status`, …). Press **Ctrl+C** to stop the gateway.

## Configuration

m3 does **not** read `~/.claude/settings.json`. Use `~/.m3/`:

| File | Purpose |
|------|---------|
| `~/.m3/m3.json` | Gateway, models, agent, channels |
| `~/.m3/secrets.json` | API keys — **chmod 600**, never commit |

Templates: [examples/m3.json](./examples/m3.json), [examples/secrets.json.example](./examples/secrets.json.example)

```json
{
  "models": {
    "default": "deepseek/deepseek-chat",
    "providers": {
      "deepseek": {
        "api": "openai-chat",
        "baseUrl": "https://api.deepseek.com",
        "apiKeyEnv": "M3_DEEPSEEK_API_KEY"
      }
    }
  },
  "agent": {
    "engine": "native",
    "model": "deepseek/deepseek-chat",
    "channelPermissionMode": "bypassPermissions",
    "sandbox": { "enabled": true }
  }
}
```

## CLI commands

| Command | Description |
|---------|-------------|
| `m3` | Interactive gateway + REPL |
| `m3 chat` | Same as above |
| `m3 gateway` | Start gateway daemon |
| `m3 gateway stop` | Stop gateway on configured port |
| `m3 channels scan` | QR bind Feishu (WeChat placeholder) |
| `m3 channels configure` | Interactive channel wizard |
| `m3 channels list` | List channel accounts |
| `m3 channels remove` | Remove a channel account |
| `m3 doctor` | Health check |
| `m3 status` | Port / PID / dashboard URL |
| `m3 agent -p "..."` | Headless one-shot agent |
| `m3 completion install` | Install zsh tab completion |

## Architecture

```
Channels (Feishu / Slack / WebChat)
        → Gateway → Bridge (pipeline, routing, slash commands)
        → AgentEngine (native | mock | legacy-cli)
        → LLM + Tools (Read/Write/Bash/MCP/Skills)
```

Details: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

## Channel setup

Feishu QR setup, Slack Socket Mode, pairing, permissions: [docs/CHANNELS.md](./docs/CHANNELS.md)

## Verification

```bash
pnpm test
m3 doctor
pnpm verify:mcp:connect
pnpm verify:hello-plugin    # needs API key in ~/.m3/secrets.json
```

## Roadmap

See [docs/IMPROVEMENTS.md](./docs/IMPROVEMENTS.md) and [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## License

MIT
