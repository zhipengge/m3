# MiniMax 模型

m3 通过 **OpenAI 兼容** Chat Completions API 调用 MiniMax（与 DeepSeek 相同适配器）。

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
