<img src="docs/assets/logo-icon.png" align="right" width="72" alt="" />

# m3

**Multi-modality · Multi-task · Multi-agent Framework**

An agent framework with OpenClaw-style channels, an in-process harness, tools, MCP, skills, and plugins — one Node runtime from inbound message to reply.

[![version](https://img.shields.io/badge/version-0.2.0-111?style=flat-square)](https://github.com/zhipengge/m3)
[![node](https://img.shields.io/badge/node-%E2%89%A522.19-111?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-111?style=flat-square)](#)

[Install](#install) · [Usage](#usage) · [Local model](#local-offline-model) · [MiniMax](docs/MINIMAX.md) · [Features](#features) · [Architecture](#architecture) · [Channels](docs/CHANNELS.md)

> Channel event → bridge → native agent loop → LLM + tools → reply on the same channel. No external CLI subprocess. Config in `~/.m3/`.

## Install

```bash
git clone git@github.com:zhipengge/m3.git && cd m3
./install.sh && export PATH="$HOME/.local/bin:$PATH"

mkdir -p ~/.m3
cp examples/secrets.json.example ~/.m3/secrets.json   # API keys
chmod 600 ~/.m3/secrets.json
cp examples/m3.json ~/.m3/m3.json                     # optional

m3 doctor
```

| Optional | Command |
|----------|---------|
| Tab completion | `m3 completion install && exec zsh` (global `m3` only) |
| Feishu QR setup | `m3 channels scan` |
| Offline LLM | `m3 local` (GGUF presets or custom repo + llama.cpp; default Qwen3-VL-4B) |

Node **≥ 22.19** · macOS / Linux · `tar` / `unzip` for local setup

## Usage

```bash
m3                    # gateway + terminal REPL (default)
m3 channels scan      # bind Feishu, then run m3
m3 status             # dashboard → http://127.0.0.1:18790/dashboard
m3 agent -p "…"       # one-shot, no REPL
m3 gateway stop       # stop daemon
m3 models             # list cloud + local models (API key status)
m3 model              # show active model
m3 model deepseek-chat   # switch model (writes ~/.m3/m3.json)
```

In the REPL (`›` prompt): natural language or slash commands. **Ctrl+C** exits and shuts down the gateway (press again to force quit if shutdown stalls).

### Workspace & permissions

On **`m3` / `m3 chat` startup**, m3 asks once whether it may read/write the **current working directory**:

```text
Choice [Y/n]:   Y / 是 — allow (default, Enter)
                n / 否 — deny and exit
```

After you allow, **Write / Edit** and built-in file tools run under that folder for the session (`agent.cwd` is pinned to your launch directory). In `~/.m3/mcp.json`, point the filesystem MCP server at `{{WORKSPACE}}` — **not** `/tmp` (on macOS that appears as `/private/tmp`).

| `agent.permissionMode` | Behavior |
|------------------------|----------|
| `default` | Workspace grant at startup; **Bash** may prompt separately in the REPL |
| `acceptEdits` | Auto-approve file edits; Bash still restricted |
| `bypassPermissions` | No prompts (channels default via `channelPermissionMode`) |

### Terminal UI (Ink)

Claude Code–style UI: streaming replies, breathing spinner, slash **command palette** (`/` + ↑↓ + Tab). Input uses **`ink-text-input`** (arrow keys, paste, CJK/IME-friendly).

**Reasoning models** (e.g. `MiniMax-M3`, `deepseek-reasoner`) stream a **∴ Thinking…** block before the reply. **Ctrl+O** or `/thinking` toggles expand/collapse; default is expanded (`agent.thinkingDisplay` in `~/.m3/m3.json`).

| Fallback | Command |
|----------|---------|
| Plain readline | `m3 chat --plain` or `M3_PLAIN_REPL=1` |
| Skip workspace prompt (CI) | `M3_SKIP_WORKSPACE_GRANT=1` |
| Collapsed thinking only | `"thinkingDisplay": "collapsed"` under `agent` |

Shell tab completion: `m3 completion install`.

### Cloud models

```bash
m3 models                    # list providers + API key status
m3 model                     # show active model
m3 model MiniMax-M3          # switch (writes ~/.m3/m3.json)
```

Built-in providers: **DeepSeek**, **Anthropic**, **MiniMax** (OpenAI-compatible). See [docs/MINIMAX.md](docs/MINIMAX.md).

### Slash commands (Claude Code–style)

| Command | Action |
|---------|--------|
| `/help` | List commands |
| `/status` · `/context` | Session + model + context window usage (~%, auto-compress at 90%) |
| `/clear` | Clear session (`/reset`, `/new` aliases) |
| `/compact [focus]` | Compress transcript history (same algorithm as 90% auto-compress) |
| `/goal <condition>` | Set a session goal; `/goal` shows it; `/goal clear` clears |
| `/plan` | Plan-mode prompt |
| `/model [ref]` | Show active model; switch via `m3 model <ref>` |
| `/thinking` | Toggle reasoning display (`expand` / `collapse`; Ctrl+O in Ink REPL) |
| `/mcp` · `/skills` · `/doctor` · … | See `/help` |

**Contributors:** `pnpm install && pnpm build && pnpm test`

**Verify local stack:** `pnpm build && node scripts/verify-local.mjs` (needs `m3 local` + running llama-server)

## Local offline model

Run **local GGUF** models on-device via **llama.cpp** (no cloud API key). Default: **Qwen3-VL-4B-Instruct**; use `--model` for other presets or any Hugging Face / ModelScope repo:

```bash
m3 local                              # default qwen3-vl-4b-instruct
m3 local --model qwen3-vl-8b-instruct
m3 local list
m3 chat
```

| Command | |
|---------|--|
| `m3 local` | Full setup |
| `m3 local list` | Built-in model presets |
| `m3 local download` | GGUF weights only |
| `m3 local start` / `stop` / `status` | Manage llama-server |

Details: [**docs/LOCAL.md**](docs/LOCAL.md). Install `aria2` for resume + concurrent GGUF downloads.

```bash
m3 agent -p "hello"     # one-shot against local model (auto-starts llama-server)
node scripts/verify-local.mjs   # doctor + slash cmds + local agent smoke test
```

## Features

| | |
|:--|:--|
| **Multi-modality** | Images, files, and structured media on `InboundMessage.media` → `~/.m3/media/` paths in the agent prompt |
| **Multi-task** | Feishu + Slack + WebChat in parallel; multi-account; session locks; live dashboard |
| **Multi-agent** | Per-conversation `sessionKey`, sub-agents, pairing & allowlists, channel permission modes |
| **Channels** | Feishu long connection or webhook · Slack Socket Mode · WebChat |
| **Harness** | In-process loop · DeepSeek · Anthropic · **MiniMax** · **local llama.cpp** · mock engine |
| **Security** | Workspace sandbox · Bash allowlist · audit log |
| **Ecosystem** | `SKILL.md` · MCP · `@m3/plugin-sdk` plugins |
| **DX** | `m3 models` / `m3 model` · workspace grant · Ink REPL · **∴ Thinking** (Ctrl+O) · zsh completion · `/dashboard` |

## Architecture

m3 runs as **one Node process**. Solid lines are the runtime request path (orthogonal routing); dashed lines are configuration and persistence under `~/.m3/`.

### System overview

```mermaid
%%{init: {'flowchart': {'curve': 'stepBefore', 'padding': 18}, 'themeVariables': {'fontSize': '13px'}}}%%
flowchart TB

  classDef zone fill:#f0f4f8,stroke:#8b949e,stroke-width:2px,color:#1f2328
  classDef comp fill:#ffffff,stroke:#0969da,stroke-width:1.5px,color:#1f2328
  classDef ext fill:#ddf4ff,stroke:#218bff,stroke-width:1.5px,color:#1f2328
  classDef infer fill:#fff8c5,stroke:#bf8700,stroke-width:1.5px,color:#1f2328
  classDef data fill:#fbefff,stroke:#8250df,stroke-width:1.5px,color:#1f2328
  classDef spine fill:#f0f4f8,stroke:#d0d7de,stroke-width:1px,color:#f0f4f8

  subgraph EXT["External"]
    direction LR
    EU[End users · IM apps]:::ext
    OP[Operator · m3 REPL]:::ext
  end

  subgraph L1["① Channels  @m3/channel-extensions"]
    direction LR
    F[Feishu / Lark<br/>long · webhook]:::comp
    S[Slack<br/>Socket Mode]:::comp
    W[WebChat]:::comp
    R[Terminal REPL]:::comp
  end

  CP[ChannelPlugin<br/>inbound · outbound · reactions · media download]:::comp

  subgraph L2["② Gateway  @m3/gateway"]
    direction LR
    GS[GatewayServer<br/>/health · WebSocket]:::comp
    CM[ChannelManager]:::comp
    UI[Control UI<br/>/dashboard]:::comp
    PS[Pairing store<br/>/pair codes]:::comp
  end

  subgraph L3["③ Bridge  @m3/bridge"]
    direction LR
    PL[MessagePipeline]:::comp
    RT[Agent route<br/>sessionKey]:::comp
    CMD[Slash registry<br/>/help · /clear]:::comp
    LK[Session lock]:::comp
    PB[Permission bridge<br/>channel mode]:::comp
  end

  subgraph L4["④ Agent  @m3/agent"]
    direction LR
    NE[NativeEngine<br/>no CLI subprocess]:::comp
    QL[Query loop<br/>stream · maxTurns]:::comp
    TO[Tool layer<br/>Read · Write · Bash · Grep]:::comp
    EX[Skills · MCP · @m3/plugin-sdk]:::comp
    SEC[Permissions · sandbox · audit]:::comp
  end

  subgraph L5["⑤ Inference"]
    direction LR
    RTM[LLM router<br/>Provider API]:::comp
    CLD[Cloud APIs<br/>DeepSeek · Anthropic · MiniMax]:::infer
    LOC[Local GGUF<br/>Qwen3-VL · llama.cpp]:::infer
  end

  subgraph DATA["Persistence  ~/.m3/"]
    direction LR
    CFG[(m3.json)]:::data
    KEY[(secrets.json)]:::data
    SES[(sessions · pairing)]:::data
    MED[(media/)]:::data
    MDL[(models/ · local.json)]:::data
  end

  N0((" ")):::spine
  N1((" ")):::spine
  N2((" ")):::spine
  N3((" ")):::spine
  N4((" ")):::spine
  N5((" ")):::spine

  EU -.-> F
  EU -.-> S
  EU -.-> W
  OP -.-> R
  F --> N0
  S --> N0
  W --> N0
  R --> N0
  N0 --> CP --> N1
  N1 --> GS
  CM --> GS
  UI --> GS
  PS --> GS
  GS --> N2
  RT --> PL
  CMD --> PL
  LK --> PL
  PB --> PL
  N2 --> PL --> N3
  N3 --> NE
  NE --> QL
  QL --> TO
  QL --> EX
  QL --> SEC
  QL --> N4
  N4 --> RTM
  RTM --> CLD
  RTM --> LOC

  CFG -.-> GS
  CFG -.-> NE
  KEY -.-> RTM
  SES -.-> PL
  SES -.-> PS
  MED -.-> CP
  MDL -.-> LOC

  class EXT,L1,L2,L3,L4,L5,DATA zone
```

| Symbol | Meaning |
|:--|:--|
| Solid arrows | Inbound dispatch → agent turn → inference |
| Dashed arrows | Config, secrets, sessions, downloaded media |
| `stepBefore` routing | Horizontal / vertical connectors only (no arcs) |

### Message lifecycle

```mermaid
%%{init: {'sequence': {'mirrorActors': false, 'wrap': true}}}%%
sequenceDiagram
  autonumber
  box rgba(240,244,248,0.6) Channels
    participant IM as Feishu / Slack / WebChat
  end
  box rgba(240,244,248,0.6) Gateway + Bridge
    participant GW as GatewayServer
    participant PL as MessagePipeline
  end
  box rgba(240,244,248,0.6) Agent
    participant AG as NativeEngine
    participant TL as Tools + Skills + MCP
  end
  participant LLM as Cloud or llama.cpp

  IM->>GW: channel event (text / media)
  GW->>PL: handleInbound()
  PL->>PL: allowlist · pairing · route sessionKey
  PL->>PL: slash command? → CommandBridge
  PL->>AG: engine.run(prompt, sessionId)
  AG->>TL: collectTools · permission check
  loop Until end_turn or maxTurns
    AG->>LLM: completeTurn (stream)
    LLM-->>AG: text delta · tool_use
    AG->>TL: execute tool (sandbox / audit)
    AG-->>PL: HarnessEvent stream
    PL-->>IM: reply · reaction · typing
  end
```

### Layer reference

| Layer | Package | Key modules |
|:--|:--|:--|
| **Channels** | `channel-extensions` | Feishu (long / webhook), Slack Socket Mode, WebChat, `ChannelPlugin` contract |
| **Gateway** | `gateway` | `GatewayServer`, `ChannelManager`, control UI, pairing API, `EventLog` |
| **Bridge** | `bridge` | `MessagePipeline`, `resolveAgentRoute`, slash commands, `SessionLock`, `PermissionBridge` |
| **Agent** | `agent` | `NativeEngine`, `runQueryLoop`, built-in tools, Skills, MCP pool, plugins, sandbox |
| **Inference** | `agent` + `@m3/local` | `LLM router` → DeepSeek / Anthropic / MiniMax, or `m3 local` → OpenAI-compatible server |

Full design notes → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Configuration

| Path | Contents |
|------|----------|
| `~/.m3/m3.json` | Models, gateway, agent, channels |
| `~/.m3/secrets.json` | API keys — never commit |

Templates: [`examples/m3.json`](examples/m3.json) · [`examples/secrets.json.example`](examples/secrets.json.example) · [`examples/mcp.json`](examples/mcp.json) (`{{WORKSPACE}}` for filesystem MCP)

<details>
<summary>Example <code>agent</code> block</summary>

```json
{
  "agent": {
    "engine": "native",
    "model": "minimax/MiniMax-M3",
    "thinkingDisplay": "expanded",
    "channelPermissionMode": "bypassPermissions",
    "sandbox": { "enabled": true }
  }
}
```

</details>

Channel setup: [**docs/CHANNELS.md**](docs/CHANNELS.md)

## CLI

| Command | |
|---------|--|
| `m3` / `m3 chat` | Interactive gateway + REPL |
| `m3 gateway` | Start gateway |
| `m3 gateway stop` | Stop gateway |
| `m3 channels scan` | Feishu QR onboarding |
| `m3 channels configure` | Channel wizard |
| `m3 channels list` / `remove` | Manage accounts |
| `m3 doctor` / `m3 status` | Health · port · PID · dashboard URL |
| `m3 models` / `m3 model <ref>` | List or switch active LLM |
| `m3 agent -p "…"` | Headless prompt |
| `m3 completion install` | zsh completions |
| `m3 local` | Offline GGUF models (default Qwen3-VL-4B; `--model` for others) |

## Develop

```bash
pnpm test && m3 doctor && pnpm verify:mcp:connect
```

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) · [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md)

---

MIT
