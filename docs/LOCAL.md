# Local offline models (GGUF + llama.cpp)

Run **GGUF** models fully offline with **llama.cpp** (`llama-server` OpenAI-compatible API). m3 routes agent traffic to `http://127.0.0.1:8080/v1` when the active model uses the `local/` provider.

**Default model:** `qwen3-vl-4b-instruct` (Qwen3-VL-4B-Instruct). Use `--model` to pick another preset or any Hugging Face / ModelScope GGUF repo.

## Quick setup

```bash
m3 local
```

This will:

1. **Pick a download mirror** — Hugging Face if reachable, otherwise ModelScope (`--mirror` to override)
2. **Resolve & download GGUF** — main weights (+ `mmproj` for vision models) → `~/.m3/models/<model-id>/`  
   Uses **aria2c** when installed: **resume** (`-c`) + **parallel** (`-j2` by default). Falls back to built-in HTTP downloader with **Range** resume.
3. **Install llama.cpp** — latest release binary for your OS → `~/.m3/runtime/llama.cpp/`
4. **Patch `~/.m3/m3.json`** — `local` provider + default model `local/<id>`
5. **Start `llama-server`** — port **8080** by default

Then use m3 as usual:

```bash
m3 chat
m3 agent -p "describe this repo"
```

Gateway and agent commands **auto-start** the local server when the configured model uses the `local/` provider.

In REPL or channels, slash commands work the same as with cloud models (`/help`, `/goal`, `/compact`, `/context`, `/clear`). Context auto-compresses at **90%** window usage; `/compact` forces the same compression on the transcript.

```bash
node scripts/verify-local.mjs   # smoke test: doctor, llama health, slash cmds, m3 agent -p
```

## Choosing a model

```bash
m3 local list                                    # built-in presets
m3 local                                         # default: qwen3-vl-4b-instruct
m3 local --model qwen3-vl-8b-instruct            # another preset
m3 local --model Qwen/Qwen2.5-7B-Instruct-GGUF   # custom repo (auto-list GGUF files)
```

| Preset id | Notes |
|-----------|--------|
| `qwen3-vl-4b-instruct` | **Default** — vision, fixed filenames |
| `qwen3-vl-8b-instruct` | Vision — files discovered from repo |
| `qwen2.5-vl-7b-instruct` | Vision |
| `qwen2.5-7b-instruct` | Text only (no mmproj) |
| `llama-3.2-3b-instruct` | Text only |

For custom repos, pass `Org/Repo-GGUF` (or `Org/Name` — `-GGUF` is appended if missing). m3 lists `.gguf` files on the mirror and picks weights matching `--quant` plus an `mmproj` when the repo looks like a vision model.

## Commands

| Command | Description |
|---------|-------------|
| `m3 local` | Full setup (download + binary + config + start) |
| `m3 local list` | Show built-in model presets |
| `m3 local download` | GGUF weights only |
| `m3 local start` | Start llama-server |
| `m3 local stop` | Stop llama-server |
| `m3 local status` | Weights / binary / server health |

### Options (`m3 local`)

| Flag | Default | Meaning |
|------|---------|---------|
| `--model` | `qwen3-vl-4b-instruct` | Preset id or `Org/Repo-GGUF` |
| `--mirror` | `auto` | `huggingface` \| `modelscope` \| `auto` |
| `--quant` | `Q4_K_M` | `Q8_0` for higher quality (larger download) |
| `--port` | `8080` | llama-server listen port |
| `--ctx-size` | preset / `32768` | llama-server context window |
| `--skip-download` | — | Reuse existing weights |
| `--no-start` | — | Setup without starting server |
| `--connections` | `16` | aria2c connections per file (`-x` / `-s`) |
| `--concurrent` | `2` | aria2c parallel files (`-j`) |
| `--no-aria2` | — | Built-in downloader only |
| `--aria2-path` | — | Explicit `aria2c` binary path |

### aria2 (recommended)

```bash
brew install aria2          # macOS
sudo apt install aria2      # Debian/Ubuntu
m3 local                    # auto-detects aria2c
```

GGUF files download together with `-j2`. Interrupted runs resume via aria2 control files (`.aria2`) or `.part` + HTTP Range without aria2.

## Disk & runtime

| Item | Approx. size (varies by model) |
|------|----------------|
| Qwen3-VL-4B Q4_K_M + mmproj | ~3–4 GB |
| Larger VL / text models | see repo |
| llama.cpp binary archive | ~50–80 MB |
| RAM at inference | 8 GB+ recommended (more for 8B+) |

State file: `~/.m3/local.json` · PID: `~/.m3/llama-server.pid` · weights: `~/.m3/models/<model-id>/`

## Config snippet

After `m3 local`, `~/.m3/m3.json` includes:

```json
{
  "models": {
    "default": "local/qwen3-vl-4b-instruct",
    "providers": {
      "local": {
        "api": "openai-chat",
        "baseUrl": "http://127.0.0.1:8080/v1",
        "localOnly": true,
        "models": {
          "qwen3-vl-4b-instruct": {
            "alias": "Qwen3-VL-4B-Instruct (local)",
            "maxTokens": 4096,
            "maxContextTokens": 32768
          }
        }
      }
    }
  },
  "agent": {
    "engine": "native",
    "model": "local/qwen3-vl-4b-instruct"
  },
  "local": {
    "model": "qwen3-vl-4b-instruct",
    "repo": "Qwen/Qwen3-VL-4B-Instruct-GGUF",
    "ctxSize": 32768,
    "serverPort": 8080
  }
}
```

No API key is required (`localOnly: true`). Switch models by re-running `m3 local --model <id>` (updates default + downloads if needed).

## Troubleshooting

| Issue | Action |
|-------|--------|
| Download slow / fails | `m3 local --mirror modelscope` or `--mirror huggingface` |
| No GGUF for quant | Try `--quant Q8_0` or another preset; check repo on HF |
| Server not healthy | `m3 local status` then `m3 local stop && m3 local start` |
| Port 8080 in use | `m3 local --port 8081` (updates config baseUrl) |
| Context overflow | m3 auto-compresses history at **90%** window usage; raise `--ctx-size` or `/clear`; restart server after ctx change |
| Still uses cloud model | Check `agent.model` in `m3.json`; run `m3 doctor` |

Default weights: [Qwen/Qwen3-VL-4B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF)
