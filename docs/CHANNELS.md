# Channels — Feishu / Slack / WebChat

通道是 m3 的"接入面"。一个 Gateway 进程内可以同时挂多个通道、多个账号；每条入站消息走同一条 `MessagePipeline`、同一份工具/权限/审计，只是回包方向不同。本文是配置与联调指南，安全模型与一般原则见 [`README.md`](../README.md#security-model)。

```
External         ┐
  Feishu / Slack │
  WebChat        ├──► Channel → Bridge → Agent → LLM → reply on same channel
  Terminal       │
                 ┘
```

## 在选通道前先理解的两个开关

| 开关 | 在哪 | 默认 | 作用 |
|------|------|------|------|
| `channelPermissionMode` | `agent.channelPermissionMode` | `default` | **远程消息**用什么权限模式。`default` = Bash / 越界写入仍要审批；`acceptEdits` = 文件改动自动放行；`bypassPermissions` = 完全放行（高危）。 |
| `dmPolicy` | `channels.<kind>.<account>.dmPolicy` | `pairing`（scan 默认） | 谁能跟 Bot 对话。`pairing` = 必须 `/pair CODE`；`open` = 任何用户。 |

> 远程通道没有终端、无法弹审批框。这两个开关合起来回答一个问题：**陌生人发一条 `rm -rf` 给 Bot 会怎样？** 在默认配置下：连话都说不上（pairing），就算配上对，Bash 也会被 `channelPermissionMode: default` 拦下。

---

## 终端 REPL（也是一种通道）

```bash
m3              # 等同 m3 chat
m3 chat
m3 chat --plain # 关掉 Ink，回到 readline
```

出现 `›` 提示符后：自然语言 / slash 命令（`/help`、`/status`、`/compact`、`/plan`、`/goal`、`/model`、`/quit`）。**Ctrl+C** 双击退出；单击只清当前输入并提醒。

### Tab 自动补全（zsh / bash）

```bash
./install.sh --with-completion           # 一次性
# 或安装好之后：
m3 completion install && exec zsh        # zsh
m3 completion install && source ~/.bashrc  # bash
```

补全要求 `m3` 在 PATH 中（即从 `~/.local/bin/m3` 运行）。`pnpm m3` 路径下无法启用补全。

---

## 前置准备

```bash
./install.sh
$EDITOR ~/.m3/secrets.json   # 至少填一个 provider 的 apiKey
m3 doctor                    # 自检：Node、配置、密钥占位符、端口、MCP
```

开发态可以 `pnpm install && pnpm build && pnpm m3 …`，但**绑定通道建议走全局 `m3`**，否则补全和 `m3 status` 找不到 PID。

---

## 飞书 / Lark

### 推荐路径：扫码配置

不要 Verification Token、不要 ngrok。默认用飞书官方**长连接**接收事件。

```bash
m3 channels scan              # 终端打印二维码（默认 127.0.0.1）
m3 channels scan --lan        # 允许手机扫码（绑 0.0.0.0，会警告）
```

1. 手机扫码 → 网页只填 **App ID** + **App Secret**（飞书开放平台复制）。
2. 提交后写入 `~/.m3/m3.json`，默认 `dmPolicy: "pairing"`、`allowFrom: []` —— **保存即安全**。
3. 启动 Gateway：`m3 gateway`（保持运行）。
4. 飞书开放平台 → **事件与回调** → 订阅方式 → **使用长连接接收事件** → 添加 `im.message.receive_v1`。
5. 权限里勾上 `im:message`（接收消息）和 `im:message.reactions:write_only`（用 OK 表情确认收到）。

> 长连接要求先让 `m3 gateway` 跑起来并保持连接，再在开放平台保存「长连接」订阅方式。

### 备选路径：交互式问答 / 手写 JSON

```bash
m3 channels configure
m3 channels list
m3 channels remove
```

或直接写 `~/.m3/m3.json`：

```json5
{
  "channels": {
    "feishu": {
      "default": {
        "enabled": true,
        "appId": "cli_xxx",
        "appSecret": "xxx",
        // 长连接：留空 webhookPath / webhookPort
        // webhook：填路径、端口、verificationToken，并自行内网穿透
        "webhookPath": "/feishu/events",
        "webhookPort": 18791,
        "verificationToken": "your-token",
        "dmPolicy": "pairing",
        "allowFrom": []
      }
    }
  }
}
```

### 首次对话与 `/pair`

`pairing` 模式下，未配对用户发第一条消息会收到：

```
未配对。请发送：/pair ABCD12
```

配对码可以从 **Dashboard → Pairing 面板**（`http://127.0.0.1:18790/dashboard`）签发，也可以 `m3 pair issue` 生成。配对成功后写入 `~/.m3/pairing.json`，未来对话直接放行。

### 多模态附件

入站图片/文件自动落盘到：

```
~/.m3/media/feishu/<account>/<message_id>.<ext>
```

随后 prompt 末尾自动追加：

```
[Attachments — use Read tool on these paths if needed]
- [image] ~/.m3/media/feishu/default/xxx.png (image/png)
```

Agent 在沙箱内可以 `Read` 这些路径（沙箱已经把 `~/.m3/media/` 加入只读白名单）。**不要**把 `agent.cwd` 设为 `/tmp` —— 在 macOS 上 realpath 会跳到 `/private/tmp`，过去这是常见踩坑。

### 常见问题

| 现象 | 处理 |
|------|------|
| URL 校验失败 | 检查 `verificationToken` 一致 / 端口未被占用 / 内网穿透指向 `webhookPort` |
| 收不到消息 | App 已发布；用户/群已加 Bot；事件订阅了 `im.message.receive_v1` |
| 不显示 OK 表情 | 缺 `im:message.reactions:write_only` 权限 |
| 图片下载失败 | 缺 IM 资源权限；查 `[m3:audit]` 与 `feishu image download failed` |

---

## Slack（Socket Mode）

### 1. Slack App

1. [api.slack.com/apps](https://api.slack.com/apps) → 新建 App。
2. **OAuth & Permissions** → Bot Token Scopes：`app_mentions:read`、`chat:write`、`files:read`、`im:history`、`channels:history`（按用例增减）。
3. 装到 Workspace → 复制 **Bot User OAuth Token**（`xoxb-…`）。
4. **Basic Information → App-Level Tokens** → 新建带 `connections:write` 的 token（`xapp-…`）。
5. **Socket Mode** → 启用。

### 2. m3 配置

```json5
{
  "channels": {
    "slack": {
      "default": {
        "enabled": true,
        "botToken": "xoxb-...",
        "appToken": "xapp-...",
        "dmPolicy": "pairing",
        "allowFrom": []
      }
    }
  }
}
```

> `isConfigured` 同时要求 `botToken` 与 `appToken`，单填一个不算装好。

### 3. 验证

```bash
m3 gateway
# 日志：slack default: Socket Mode connected
```

DM / @ Bot → Agent 回复。文件落盘到 `~/.m3/media/slack/<account>/`，prompt 自动附路径。

### 常见问题

| 现象 | 处理 |
|------|------|
| `requires botToken + appToken` | 补 app-level token（Socket Mode） |
| 发消息无回复 | 检查 `dmPolicy` / `allowFrom`；确认 Gateway 不是 `--mock` 且模型 Key 有效 |
| 附件未落盘 | 缺 `files:read`；文件需带 `url_private` |

---

## WebChat（快速冒烟）

无需外网，5 秒验证 Bridge → Agent → 回包链路：

```bash
M3_MOCK_AGENT=1 node packages/cli/dist/cli.js webchat --mock
```

或正式接入：把 `channels.webchat.default.enabled` 设为 `true`，浏览器打开 dashboard 里的 WebChat 入口。

---

## 通道写权限调优（重要）

被 IM 用户高频触发 `Permission denied`？这是默认配置在保护你。三种调法（择一或组合）：

```jsonc
// 1. 推荐：白名单常用工具，Bash 仍需审批
"agent": {
  "permissions": { "allow": ["Read", "Grep", "Glob", "Edit", "Write"] }
}

// 2. 较松：信任的通道自动放行文件改动
"agent": { "channelPermissionMode": "acceptEdits" }

// 3. 完全放行（仅限 allowFrom 白名单 + 一次性脚本场景）
"agent": { "channelPermissionMode": "bypassPermissions" }
//  ⚠ 配合 dmPolicy: "pairing" + 严格 allowFrom 使用，否则等于把 shell 暴露给所有联系人
```

改完**重启 Gateway**：

```bash
pnpm build && m3 gateway
```

仍被拒？看终端 `[m3:audit] permission denied tool=…`，按工具名追加到 `permissions.allow`。

> 终端会话走 `agent.permissionMode`（默认 `default`，可用 `/permissions` 改），与 `channelPermissionMode` **互不影响**。这是 m3 跟 CC / 通用 SDK 不同的地方：远程入口和本地入口分账。

---

## 本地无公网时如何联调飞书 webhook 模式

长连接模式不需要外网。如果一定要走 webhook：

```bash
ngrok http 18791                   # 或 cloudflared tunnel run …
```

把公网 URL + `/feishu/events` 填到飞书事件订阅；本机 `m3 gateway` 保持运行。

---

## 多账号 / 多通道并行

`channels.<kind>` 是一个对象，key 是账号名：

```json
{
  "channels": {
    "feishu": {
      "default": { "enabled": true, "appId": "cli_a", "appSecret": "..." },
      "ops":     { "enabled": true, "appId": "cli_b", "appSecret": "...", "dmPolicy": "pairing" }
    },
    "slack": {
      "default": { "enabled": true, "botToken": "xoxb-...", "appToken": "xapp-..." }
    }
  }
}
```

同一个 Gateway 进程会同时启动这些账号；`MessagePipeline` 用 `(channel, account, peer)` 作为 `sessionKey` 区分会话，互不干扰。

---

## 下一步

- 切换模型 / 加自定义 provider → [`README.md → A 30-second tour`](../README.md#a-30-second-tour)
- 离线 GGUF + Qwen3-VL → [`docs/LOCAL.md`](LOCAL.md)
- 沙箱、Bash 安全、审计 → [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
- 还没接通？先 `m3 doctor`，再看 `~/.m3/event-log.jsonl`
