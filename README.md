<div align="center">

<img src="docs/assets/logo-icon.png" width="96" alt="m3" />

# m3

### One agent process. Many channels. Local or cloud. Yours.

**Multi-modality · Multi-task · Multi-agent framework** — a single Node runtime that takes a message from Feishu, Slack, WebChat, or your terminal and routes it through one in-process agent loop with tools, MCP, skills, and plugins.

[![version](https://img.shields.io/badge/version-0.2.0-111?style=flat-square)](https://github.com/zhipengge/m3)
[![node](https://img.shields.io/badge/node-%E2%89%A522.19-111?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![tests](https://img.shields.io/badge/tests-406%20passing-2ea043?style=flat-square)](#develop)
[![license](https://img.shields.io/badge/license-MIT-111?style=flat-square)](#license)

[Quick start](#quick-start) · [Why m3](#why-m3) · [Channels](docs/CHANNELS.md) · [Local model](docs/LOCAL.md) · [MiniMax](docs/MINIMAX.md) · [Architecture](#architecture)

</div>

---

## Why m3

Most agent frameworks pick one surface — a terminal (Claude Code), an IDE (Cursor), a chat box (OpenInterpreter), or an SDK (LangGraph). **m3 is the surface-agnostic one.** The same agent, with the same tools, skills, MCP servers, sandbox, and audit log, answers a Feishu DM, a Slack thread, a WebChat session, and your terminal — concurrently, in one process.

|  | m3 | Claude Code | Cursor / IDE agents | Generic SDK |
|---|---|---|---|---|
| **Surfaces** | Terminal + Feishu + Slack + WebChat (concurrent) | Terminal only | IDE only | Whatever you build |
| **Runtime** | One Node process, in-process harness | Spawns `claude` CLI subprocess | IDE-bound | DIY |
| **Local model** | `m3 local` → Qwen3-VL via llama.cpp, no code change | Cloud only | Cloud only | DIY |
| **Permission isolation** | Separate `channelPermissionMode` for remote users | Single mode | N/A | DIY |
| **Provable air-gap** | `localOnly: true` per-account guard | – | – | – |
| **Channel pairing** | `dmPolicy: "pairing"` + `/pair CODE` | – | – | – |
| **Extension paths** | MCP · Skills · `@m3/plugin-sdk` | MCP · Skills | MCP | DIY |
| **First-party install** | `./install.sh` → `~/.local/bin/m3` | npm + auth | IDE install | DIY |

The framework's three pillars:

<table>
<tr>
<td width="33%" valign="top">

### ① Multi-modality

Images, files, and structured media are a first-class field on `InboundMessage.media`. A photo dropped into Feishu auto-saves to `~/.m3/media/feishu/…`, and the path is injected into the agent prompt for the `Read` tool. No glue code.

</td>
<td width="33%" valign="top">

### ② Multi-task

Feishu + Slack + WebChat + terminal run **in parallel** in one process. Each `(channel, account, peer)` gets its own session lock, transcript, and `sessionKey`. A multi-account Feishu bot and a Slack workspace coexist without N processes.

</td>
<td width="33%" valign="top">

### ③ Multi-agent

Per-conversation routing through `resolveAgentRoute`. Pairing & allowlists scope who can talk to which agent. Sub-agents inherit the harness but get their own permission mode. Channel-routed sub-agents (C5) are on the roadmap.

</td>
</tr>
</table>

> **TL;DR** — Channel event → bridge → native agent loop → LLM + tools → reply on the same channel. No external CLI subprocess. Config in `~/.m3/`.

---

## Quick start

```bash
git clone git@github.com:zhipengge/m3.git && cd m3
./install.sh                                  # build, ~/.local/bin/m3, init ~/.m3
$EDITOR ~/.m3/secrets.json                    # paste a real API key
~/.local/bin/m3                               # or: source ~/.zshrc && m3
```

The Ink REPL (`›` prompt) opens. Type a question, slash-command, or `?` for help. **Ctrl+C** twice to exit.

<details>
<summary><strong>Other install options</strong></summary>

```bash
./install.sh --with-completion   # zsh / bash tab completion
./install.sh --skip-build        # dev iteration

m3 init                          # bootstrap ~/.m3/ only
m3 channels scan                 # Feishu QR onboarding (loopback; --lan for phone)
m3 local                         # offline Qwen3-VL via llama.cpp
```

Node **≥ 22.19** · macOS / Linux · `tar` / `unzip` for local setup. Optional `aria2` for resumable GGUF downloads.

</details>

If anything looks off:

```bash
m3 doctor    # Node, config, secrets, ports, placeholder keys, channels, MCP, local model
```

`doctor` is the single source of truth — placeholder API keys, loose `secrets.json` permissions, non-loopback gateway without `authToken`, missing config: all surfaced with the exact command to fix.

---

## A 30-second tour

### Talk to the agent

```bash
m3                              # gateway + Ink REPL (default)
m3 chat                         # same, explicit
m3 agent -p "summarise README"  # one-shot, prints to stdout
m3 chat --plain                 # plain readline (no Ink)
```

Inside the REPL, slash commands work the same everywhere:

```bash
/help              # category-grouped menu (Tab to complete)
/status            # session, model, context fill %, auto-compress at 90%
/compact           # compress transcript (focus optional)
/plan              # plan-mode prompt
/goal <when done>  # session goal until satisfied
/model <ref>       # show or switch active model
/thinking          # toggle reasoning (Ctrl+O in Ink)
/retry             # resend last message
/cost              # tokens + USD (cap with agent.costCapUsd)
/permissions       # interactive picker
/clear             # soft-delete session (recover with /clear undo)
/quit              # exit (Ctrl+C twice equivalent)
```

### Switch models without code

```bash
m3 models                       # list providers + API key status
m3 model deepseek-chat          # cloud
m3 model MiniMax-M3             # reasoning model — streams ∴ Thinking
m3 model local/qwen3-vl-4b-instruct
```

Adding a new OpenAI-compatible provider is a ~30-line block in `m3.json` (`api`, `baseUrl`, `apiKeyEnv`, `models`) — no source code change.

### Run a real local model

```bash
m3 local                        # default: Qwen3-VL-4B-Instruct
m3 local --model qwen3-vl-8b-instruct
```

Downloads weights to `~/.m3/models/`, installs llama.cpp to `~/.m3/runtime/`, patches `m3.json` to add a `local` provider, and starts `llama-server` on `:8080`. The next `m3 chat` auto-starts the server when the active model is `local/…`. With `localOnly: true` set in the provider block, the pipeline **refuses** to instantiate any non-local provider for that account — defense in depth against a typo leaking customer data.

### Bind a channel

```bash
m3 channels scan                # QR onboarding (loopback; --lan for phone scan)
m3 channels list                # see what's wired
```

`scan` writes safe defaults: `dmPolicy: "pairing"`, empty `allowFrom`. The bot only replies to peers who DM `/pair <code>`, and channel runs go through the permission manager (Bash and out-of-workspace writes are gated) instead of `bypassPermissions`. Both can be relaxed, but the dangerous default is opt-in.

See [docs/CHANNELS.md](docs/CHANNELS.md) for Feishu + Slack production setup.

---

## Architecture

m3 runs as **one Node process** with five horizontally-stacked layers. Solid arrows are the runtime request path; dashed arrows are config + persistence under `~/.m3/`.

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

| Layer | Package | Key modules |
|:--|:--|:--|
| **① Channels** | `channel-extensions` | Feishu (long / webhook), Slack Socket Mode, WebChat, `ChannelPlugin` contract |
| **② Gateway** | `gateway` | `GatewayServer`, `ChannelManager`, dashboard, pairing API, `EventLog` |
| **③ Bridge** | `bridge` | `MessagePipeline`, `resolveAgentRoute`, slash commands, `SessionLock`, `PermissionBridge` |
| **④ Agent** | `agent` | `NativeEngine`, `runQueryLoop`, built-in tools, Skills, MCP pool, plugins, sandbox |
| **⑤ Inference** | `agent` + `@m3/local` | `LLM router` → DeepSeek / Anthropic / MiniMax, or `m3 local` → OpenAI-compatible `llama-server` |

Full design notes → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Sequence diagram of a single turn is there too.

---

## Security model

m3 ships safe-by-default; the dangerous knobs are visible in `m3 doctor` and named explicitly in config.

| Concern | Default |
|---|---|
| Workspace boundary | `realpath`-checked sandbox; symlink escapes raise `SandboxViolationError` |
| Bash safety | Static rules for `rm -rf /`, `curl \| sh`, `sudo`, `ssh user@host`, `nc -l`, `python/node -e`, `git push --force`, fork bombs (17 patterns) |
| Bash env | Allowlist; **even with operator allowlisting**, names matching `KEY`/`SECRET`/`TOKEN`/`PASSWORD`/`CREDENTIAL` are blocked |
| Channel inbound | `channelPermissionMode: "default"` — Bash and out-of-workspace writes are gated. `bypassPermissions` is opt-in. |
| Feishu scan | `dmPolicy: "pairing"`, empty `allowFrom`. No one talks to the bot until they DM `/pair <code>`. |
| Gateway WS | Workspace param is validated against `agent.cwd`; non-loopback bind without `authToken` is a doctor error. |
| Secrets file | `0o600` atomic write; loose permissions warn on load; parse errors fail loudly (never silently empty). |
| Audit | `[m3:audit]` JSON line per tool execution / permission decision, with secret redaction. |

---

## Configuration

| Path | Contents |
|------|----------|
| `~/.m3/m3.json` | Models, gateway, agent, channels, plugins |
| `~/.m3/secrets.json` | API keys — `0o600`, never commit |
| `~/.m3/mcp.json` | MCP servers (`{{WORKSPACE}}` for filesystem MCP) |
| `~/.m3/sessions.json` | Session ↔ channel mapping |
| `~/.m3/pairing.json` | `/pair` allowlist |
| `~/.m3/transcripts/` | Per-session chat history (soft-deleted to `_archive/` on `/clear`) |
| `~/.m3/media/<channel>/<account>/` | Inbound attachments |
| `~/.m3/memory/<project>.md` | Cross-session memory (`/memory`) |

Templates: [`examples/m3.json`](examples/m3.json) · [`examples/secrets.json.example`](examples/secrets.json.example) · [`examples/mcp.json`](examples/mcp.json)

<details>
<summary>Minimal <code>agent</code> block</summary>

```json
{
  "agent": {
    "engine": "native",
    "model": "minimax/MiniMax-M3",
    "thinkingDisplay": "expanded",
    "channelPermissionMode": "default",
    "permissions": { "allow": ["Read", "Grep", "Glob", "Edit", "Write"] },
    "sandbox": { "enabled": true },
    "costCapUsd": 5.00
  }
}
```

</details>

---

## Extensibility

Three layers of extension share the same `ToolDefinition` contract:

- **MCP** — point `agent.mcp.config` at a standard `mcpServers` JSON. Stdio + SSE, env is whitelisted, filesystem MCP roots auto-scope to the workspace.
- **Skills** — Anthropic-format `SKILL.md` files under `agent.skills.dirs`. Frontmatter goes into the system prompt; the body is loaded on demand via the `Skill` tool (progressive disclosure).
- **Plugins** — `@m3/plugin-sdk` for ESM plugins that register tools, slash commands, or channels. SHA-pinned on first load.

```typescript
import { definePlugin, registerM3Plugin } from "@m3/plugin-sdk";

registerM3Plugin(definePlugin({
  id: "my-plugin",
  register(api) {
    api.registerTool({ name: "MyTool", /* … */ });
    api.registerCommand("my-cmd", () => ({ action: "reply_only", text: "ok" }));
  },
}));
```

Built-in `hello` plugin lives at `examples/plugins/hello-plugin.mjs` — copy and adapt.

---

## Develop

```bash
pnpm install && pnpm build
pnpm test              # 406 tests across config, agent, bridge, gateway, cli
pnpm typecheck
pnpm verify:mcp:connect
```

| | |
|---|---|
| Monorepo layout | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| Layered architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Channel setup (Feishu, Slack) | [docs/CHANNELS.md](docs/CHANNELS.md) |
| Local GGUF runtime | [docs/LOCAL.md](docs/LOCAL.md) |
| MiniMax provider | [docs/MINIMAX.md](docs/MINIMAX.md) |
| Roadmap (deferred Tier C) | [docs/ROADMAP-2026.md](docs/ROADMAP-2026.md) |
| Improvement log | [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) |

---

## License

MIT
