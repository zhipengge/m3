# MiniMax · Reasoning models

m3 通过 **OpenAI 兼容** Chat Completions API 调用 MiniMax（与 DeepSeek、本地 `llama-server` 同一条 router）。MiniMax-M3 等推理模型的 `reasoning_content` / `reasoning_details` 字段会被自动解析，在 Ink REPL 里渲染为 `∴ Thinking` 流式块。

> 设计取舍：m3 不绑死任何一家厂商。`provider/model` 是一个字符串、`api: "openai-chat"` 是一段 30 行 JSON —— 新增 provider **不用动源码**。下面就是 MiniMax 的最小配置样例。

## 配置

1. 在 `~/.m3/secrets.json` 中设置：

```json
{
  "providers": {
    "minimax": {
      "apiKey": "你的 MiniMax API Key"
    }
  }
}
```

或使用环境变量：`M3_MINIMAX_API_KEY` / `MINIMAX_API_KEY`。

2. `~/.m3/m3.json` 的 `models.providers.minimax` 已包含默认模型（见 `examples/m3.json`）。

**国内用户** 可将 `baseUrl` 改为：

```json
"baseUrl": "https://api.minimaxi.com/v1"
```

**国际** 默认：`https://api.minimax.io/v1`

## 切换模型

```bash
m3 models
m3 model minimax/MiniMax-M3
# 或局部匹配
m3 model MiniMax-M3
```

## 模型 ID（与 MiniMax 控制台一致）

| m3 ref | API model |
|--------|-----------|
| `minimax/MiniMax-M3` | MiniMax-M3 |
| `minimax/MiniMax-M2.7` | MiniMax-M2.7 |
| `minimax/MiniMax-M2.5` | MiniMax-M2.5 |
| `minimax/MiniMax-M2.1` | MiniMax-M2.1 |
| `minimax/MiniMax-M2` | MiniMax-M2 |

文档：<https://platform.minimax.io/docs/api-reference/text-openai-api>

## 思考过程（REPL）

对 `MiniMax-M3` 等推理模型，m3 会自动开启 `reasoning_split`，并在 Ink REPL 中以 **∴ Thinking** 区块流式显示推理（对齐 Claude Code）：

- 默认**展开**：流式显示完整 `∴ Thinking…` 推理过程
- 流式进行中始终展示正文；结束后可用 **Ctrl+O** 折叠
- 正文在下方 **m3** 回复框中展示

`~/.m3/m3.json` 可设 `"agent": { "thinkingDisplay": "collapsed" }` 改为仅显示标题。
